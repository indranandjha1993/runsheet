// Everything a driver does goes here first. The network is treated as an occasional luxury:
// nothing on screen ever waits for it, and nothing is lost when it never comes back.

export const MAX_BATCH = 200;

export interface MediaHandle {
  readonly mediaId: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly kind: string;
}

export interface Tap {
  readonly commandId: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly at: Date;
  readonly monotonicMs: number;
  readonly media: readonly MediaHandle[];
}

export interface QueuedEntry extends Tap {
  readonly deviceSequence: number;
}

export interface Refusal {
  readonly commandId: string;
  readonly reason: string;
}

export interface Queue {
  readonly deviceId: string;
  readonly bootId: string;
  readonly workerId: string;
  readonly runId: string;
  readonly startedAt: Date;
  readonly lastSequence: number;
  readonly pending: readonly QueuedEntry[];
  readonly refused: readonly Refusal[];
}

export interface NewQueue {
  readonly deviceId: string;
  readonly bootId: string;
  readonly workerId: string;
  readonly runId: string;
  readonly startedAt: Date;
  readonly lastSequence?: number;
  readonly pending?: readonly QueuedEntry[];
  readonly refused?: readonly Refusal[];
}

export function newQueue(input: NewQueue): Queue {
  return {
    deviceId: input.deviceId,
    bootId: input.bootId,
    workerId: input.workerId,
    runId: input.runId,
    startedAt: input.startedAt,
    lastSequence: input.lastSequence ?? 0,
    pending: input.pending ?? [],
    refused: input.refused ?? [],
  };
}

export function enqueue(queue: Queue, tap: Tap): Queue {
  if (tap.commandId.trim() === "") {
    throw new Error("a queued action needs a command identifier");
  }
  if (queue.pending.some((entry) => entry.commandId === tap.commandId)) return queue;

  const deviceSequence = queue.lastSequence + 1;
  return {
    ...queue,
    lastSequence: deviceSequence,
    pending: [...queue.pending, { ...tap, deviceSequence }],
  };
}

export interface BatchEntry {
  readonly command_id: string;
  readonly device_sequence: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly occurred_at_device: string;
  readonly monotonic_ms: number;
  readonly media: readonly {
    readonly media_id: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly kind: string;
  }[];
}

export interface Batch {
  readonly device_id: string;
  readonly device_boot_id: string;
  readonly worker_id: string;
  readonly run_id: string;
  readonly batch_id: string;
  readonly clock: { readonly device_sent_at: string; readonly device_monotonic_ms: number };
  readonly entries: readonly BatchEntry[];
}

export function batchFrom(queue: Queue, batchId: string, now: Date): Batch | undefined {
  if (queue.pending.length === 0) return undefined;

  const slice = [...queue.pending]
    .sort((a, b) => a.deviceSequence - b.deviceSequence)
    .slice(0, MAX_BATCH);

  return {
    device_id: queue.deviceId,
    device_boot_id: queue.bootId,
    worker_id: queue.workerId,
    run_id: queue.runId,
    batch_id: batchId,
    clock: {
      device_sent_at: now.toISOString(),
      device_monotonic_ms: now.getTime() - queue.startedAt.getTime(),
    },
    entries: slice.map((entry) => ({
      command_id: entry.commandId,
      device_sequence: entry.deviceSequence,
      type: entry.type,
      payload: entry.payload,
      occurred_at_device: entry.at.toISOString(),
      monotonic_ms: entry.monotonicMs,
      media: entry.media.map((media) => ({
        media_id: media.mediaId,
        sha256: media.sha256,
        bytes: media.bytes,
        kind: media.kind,
      })),
    })),
  };
}

export interface EntryResult {
  readonly commandId: string;
  readonly status: "accepted" | "duplicate" | "rejected";
  readonly reason?: string;
}

// Only what the server explicitly settled leaves the queue. Anything it said nothing about is
// still the driver's work and goes again.
export function acknowledge(queue: Queue, results: readonly EntryResult[]): Queue {
  const settled = new Map(results.map((result) => [result.commandId, result]));

  return {
    ...queue,
    pending: queue.pending.filter((entry) => !settled.has(entry.commandId)),
    refused: [
      ...queue.refused,
      ...results
        .filter((result) => result.status === "rejected")
        .map((result) => ({
          commandId: result.commandId,
          reason: result.reason ?? "the server would not take it",
        })),
    ],
  };
}
