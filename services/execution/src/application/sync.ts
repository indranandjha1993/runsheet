import { envelope } from "@runsheet/kernel";
import { routingFor } from "@runsheet/contracts";
import { reconcile, type DeviceEntry, type ReconciledTime } from "../domain/device-clock.js";
import { DomainError } from "../domain/errors.js";
import type { ExecutionDeps } from "./ports.js";

// One transaction, one response. A handset with a shift's work on it sends it in slices this
// size; more than this and a single failure costs the driver too much.
export const MAX_BATCH_ENTRIES = 200;

const SHA256 = /^[0-9a-f]{64}$/;

// What a handset is allowed to assert. Anything else is a version of the app the server does
// not know, and is refused with a reason rather than swallowed.
const ACCEPTED_TYPES = new Set([
  "stop.completed",
  "stop.failed",
  "stop.skipped",
  "proof.captured",
  "run.started",
  "run.completed",
  "run.cash_declared",
  "consignment.scanned_in",
  "consignment.scanned_out",
]);

export interface MediaManifestEntry {
  readonly mediaId: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: string;
}

export interface SyncEntry {
  readonly commandId: string;
  readonly deviceSequence: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAtDevice: Date;
  readonly monotonicMs: number;
  readonly media: readonly MediaManifestEntry[];
}

export interface SyncBatchCommand {
  readonly tenantId: string;
  readonly deviceId: string;
  readonly deviceBootId: string;
  readonly workerId: string;
  readonly runId: string;
  readonly batchId: string;
  readonly clock: { readonly deviceSentAt: Date; readonly monotonicNowMs: number };
  readonly entries: readonly SyncEntry[];
}

export type EntryStatus = "accepted" | "duplicate" | "rejected";

export interface EntryResult {
  readonly commandId: string;
  readonly status: EntryStatus;
  readonly eventId?: string;
  readonly reason?: string;
}

export interface UploadRequest {
  readonly mediaId: string;
  readonly sha256: string;
}

export interface SyncBatchResult {
  readonly batchId: string;
  readonly results: readonly EntryResult[];
  readonly uploads: readonly UploadRequest[];
}

function assertSendable(entries: readonly SyncEntry[]): void {
  if (entries.length > MAX_BATCH_ENTRIES) {
    throw new DomainError("invalid_input", "that batch is too large; split it on device sequence");
  }
  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.deviceSequence)) {
      throw new DomainError(
        "invalid_input",
        `two entries claim device sequence ${String(entry.deviceSequence)}`,
      );
    }
    seen.add(entry.deviceSequence);
  }
}

function refusalFor(entry: SyncEntry): string | undefined {
  if (!ACCEPTED_TYPES.has(entry.type)) return `this platform records no ${entry.type}`;
  const bad = entry.media.find((media) => !SHA256.test(media.sha256));
  return bad === undefined ? undefined : `${bad.mediaId} carries a hash that is not a hash`;
}

interface Prepared {
  readonly entry: SyncEntry;
  readonly time: ReconciledTime;
}

function timesFor(deps: ExecutionDeps, command: SyncBatchCommand): Map<number, ReconciledTime> {
  const readings: DeviceEntry[] = command.entries.map((entry) => ({
    deviceSequence: entry.deviceSequence,
    occurredAtDevice: entry.occurredAtDevice,
    monotonicMs: entry.monotonicMs,
  }));

  const reconciled = reconcile(
    {
      deviceBootId: command.deviceBootId,
      monotonicNowMs: command.clock.monotonicNowMs,
      offsetMs: deps.clock.now().getTime() - command.clock.deviceSentAt.getTime(),
      // Without a stored handshake the first batch after a boot anchors against itself, which is
      // the best the server can do until the device has been seen twice.
      anchorBootId: command.deviceBootId,
      serverReceivedAt: deps.clock.now(),
    },
    readings,
  );

  return new Map(reconciled.map((time) => [time.deviceSequence, time]));
}

// The subject comes out of the payload the handset sent, so it is checked before it is used as
// an identifier. A payload naming an object rather than a consignment falls back to the run.
function subjectOf(entry: SyncEntry, runId: string): string {
  const named = entry.payload["consignment_id"];
  return typeof named === "string" && named !== "" ? named : runId;
}

function payloadOf(command: SyncBatchCommand, prepared: Prepared): Record<string, unknown> {
  return {
    ...prepared.entry.payload,
    device_id: command.deviceId,
    worker_id: command.workerId,
    clock_flags: prepared.time.flags,
    media: prepared.entry.media.map((media) => ({
      media_id: media.mediaId,
      sha256: media.sha256,
      bytes: media.bytes,
      kind: media.kind,
    })),
  };
}

async function record(
  deps: ExecutionDeps,
  command: SyncBatchCommand,
  prepared: Prepared,
): Promise<EntryResult> {
  const { entry, time } = prepared;
  const claimed = await deps.repository.claimCommand(
    command.tenantId,
    command.deviceId,
    entry.commandId,
  );
  if (claimed === undefined) {
    return { commandId: entry.commandId, status: "duplicate" };
  }

  const aggregateId = subjectOf(entry, command.runId);
  const event = envelope({
    eventId: claimed,
    tenantId: command.tenantId,
    aggregateType: entry.type.startsWith("run.") ? "run" : "consignment",
    aggregateId,
    sequence: await deps.repository.nextSequence(command.tenantId, aggregateId),
    type: entry.type,
    version: 1,
    occurredAt: time.occurredAt,
    recordedAt: deps.clock.now(),
    source: "device",
    confidence: time.confidence,
  });

  await deps.publisher.publish(event, payloadOf(command, prepared), routingFor(entry.type).topic);
  return { commandId: entry.commandId, status: "accepted", eventId: event.eventId };
}

// A driver's shift arrives in one call. Nothing here rejects a whole batch for one bad entry:
// the rest of the shift is real work that has already happened.
export async function syncBatch(
  deps: ExecutionDeps,
  command: SyncBatchCommand,
): Promise<SyncBatchResult> {
  assertSendable(command.entries);

  const times = timesFor(deps, command);
  const inOrder = [...command.entries].sort((a, b) => a.deviceSequence - b.deviceSequence);

  const results: EntryResult[] = [];
  const uploads: UploadRequest[] = [];

  for (const entry of inOrder) {
    const refusal = refusalFor(entry);
    if (refusal !== undefined) {
      results.push({ commandId: entry.commandId, status: "rejected", reason: refusal });
      continue;
    }

    const time = times.get(entry.deviceSequence);
    if (time === undefined) throw new Error(`no reconciled time for ${entry.commandId}`);

    const result = await record(deps, command, { entry, time });
    results.push(result);

    // The bytes follow on their own queue. A photo backlog never holds up a delivery.
    if (result.status === "accepted") {
      uploads.push(
        ...entry.media.map((media) => ({ mediaId: media.mediaId, sha256: media.sha256 })),
      );
    }
  }

  return { batchId: command.batchId, results, uploads };
}
