import { acknowledge, batchFrom, type EntryResult, type Queue } from "../domain/queue.js";

export interface Transport {
  readonly send: (body: unknown) => Promise<{ ok: boolean; body: unknown }>;
}

export interface PushDeps {
  readonly transport: Transport;
  readonly ids: () => string;
  readonly now: () => Date;
}

export interface Upload {
  readonly mediaId: string;
  readonly sha256: string;
}

export interface PushResult {
  readonly queue: Queue;
  readonly sent: number;
  readonly uploads: readonly Upload[];
  readonly error?: string;
}

interface Reply {
  results: EntryResult[];
  uploads: Upload[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The reply decides what leaves the driver's phone, so it is read carefully rather than trusted.
// Anything that does not parse leaves the whole batch queued for the next attempt.
function readResult(entry: unknown): EntryResult | undefined {
  if (!isRecord(entry)) return undefined;
  const commandId = entry["command_id"];
  const status = entry["status"];
  if (typeof commandId !== "string") return undefined;
  if (status !== "accepted" && status !== "duplicate" && status !== "rejected") return undefined;

  const reason = entry["reason"];
  return { commandId, status, ...(typeof reason === "string" ? { reason } : {}) };
}

function readUpload(entry: unknown): Upload | undefined {
  if (!isRecord(entry)) return undefined;
  const mediaId = entry["media_id"];
  const sha256 = entry["sha256"];
  if (typeof mediaId !== "string" || typeof sha256 !== "string") return undefined;
  return { mediaId, sha256 };
}

function readReply(body: unknown): Reply | undefined {
  if (!isRecord(body) || !Array.isArray(body["results"])) return undefined;

  const results = body["results"].map(readResult);
  if (results.some((result) => result === undefined)) return undefined;

  const raw = Array.isArray(body["uploads"]) ? body["uploads"] : [];
  return {
    results: results.filter((result) => result !== undefined),
    uploads: raw.map(readUpload).filter((upload) => upload !== undefined),
  };
}

function unchanged(queue: Queue, error: string): PushResult {
  return { queue, sent: 0, uploads: [], error };
}

export async function push(queue: Queue, deps: PushDeps): Promise<PushResult> {
  const batch = batchFrom(queue, deps.ids(), deps.now());
  if (batch === undefined) return { queue, sent: 0, uploads: [] };

  let response: { ok: boolean; body: unknown };
  try {
    response = await deps.transport.send(batch);
  } catch (error) {
    return unchanged(queue, error instanceof Error ? error.message : "could not reach the office");
  }

  if (!response.ok) return unchanged(queue, "the office would not take it");

  const reply = readReply(response.body);
  if (reply === undefined) return unchanged(queue, "could not read what the office said");

  const settled = reply.results.filter((result) => result.status !== "rejected").length;
  return { queue: acknowledge(queue, reply.results), sent: settled, uploads: reply.uploads };
}
