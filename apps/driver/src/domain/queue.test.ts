import { describe, expect, it } from "vitest";
import { acknowledge, batchFrom, enqueue, MAX_BATCH, newQueue, type Queue } from "./queue.js";

const at = new Date("2026-09-07T09:00:00.000Z");

const queue = (): Queue => newQueue({ deviceId: "device-1", bootId: "boot-1", workerId: "w1", runId: "run-1", startedAt: at });

const tap = (n: number) => ({
  commandId: `cmd-${String(n)}`,
  type: "stop.completed",
  payload: { stop_id: `s${String(n)}` },
  at: new Date(at.getTime() + n * 60_000),
  monotonicMs: n * 60_000,
  media: [],
});

describe("a driver tapping with no signal", () => {
  it("keeps the tap", () => {
    const after = enqueue(queue(), tap(1));

    expect(after.pending).toHaveLength(1);
  });

  it("numbers each tap after the last, so the server can read the order", () => {
    const after = [1, 2, 3].reduce((q, n) => enqueue(q, tap(n)), queue());

    expect(after.pending.map((entry) => entry.deviceSequence)).toEqual([1, 2, 3]);
  });

  it("keeps counting across a restart, because the sequence is the causal order", () => {
    const before = [1, 2].reduce((q, n) => enqueue(q, tap(n)), queue());
    const restarted = newQueue({
      deviceId: "device-1",
      bootId: "boot-2",
      workerId: "w1",
      runId: "run-1",
      startedAt: at,
      lastSequence: before.lastSequence,
      pending: before.pending,
    });

    expect(enqueue(restarted, tap(3)).pending[2]?.deviceSequence).toBe(3);
  });

  it("ignores the same tap arriving twice, which a double press produces", () => {
    const after = enqueue(enqueue(queue(), tap(1)), tap(1));

    expect(after.pending).toHaveLength(1);
  });

  it("refuses a tap with no command identifier, because sync could not deduplicate it", () => {
    expect(() => enqueue(queue(), { ...tap(1), commandId: "" })).toThrow(
      "a queued action needs a command identifier",
    );
  });
});

describe("packing a batch to send", () => {
  it("sends nothing when there is nothing to send", () => {
    expect(batchFrom(queue(), "batch-1", at)).toBeUndefined();
  });

  it("sends what is pending, in device order", () => {
    const after = [1, 2].reduce((q, n) => enqueue(q, tap(n)), queue());
    const batch = batchFrom(after, "batch-1", at);

    expect(batch?.entries.map((entry) => entry.command_id)).toEqual(["cmd-1", "cmd-2"]);
  });

  it("never sends more in one go than the server will take", () => {
    const many = Array.from({ length: MAX_BATCH + 10 }, (_, n) => n + 1).reduce(
      (q, n) => enqueue(q, tap(n)),
      queue(),
    );

    expect(batchFrom(many, "batch-1", at)?.entries).toHaveLength(MAX_BATCH);
  });

  it("carries the boot it was minted under, so the server can trust the counter", () => {
    const after = enqueue(queue(), tap(1));

    expect(batchFrom(after, "batch-1", at)?.device_boot_id).toBe("boot-1");
  });
});

describe("what the server said about a batch", () => {
  const sent = (): Queue => [1, 2].reduce((q, n) => enqueue(q, tap(n)), queue());

  it("drops what was accepted", () => {
    const after = acknowledge(sent(), [
      { commandId: "cmd-1", status: "accepted" },
      { commandId: "cmd-2", status: "accepted" },
    ]);

    expect(after.pending).toEqual([]);
  });

  it("drops what the server already had, because it is not lost", () => {
    const after = acknowledge(sent(), [{ commandId: "cmd-1", status: "duplicate" }]);

    expect(after.pending.map((entry) => entry.commandId)).toEqual(["cmd-2"]);
  });

  it("keeps a rejected tap out of the queue but remembers why", () => {
    const after = acknowledge(sent(), [
      { commandId: "cmd-1", status: "rejected", reason: "this platform records no such thing" },
    ]);

    expect(after.pending.map((entry) => entry.commandId)).toEqual(["cmd-2"]);
    expect(after.refused).toEqual([
      { commandId: "cmd-1", reason: "this platform records no such thing" },
    ]);
  });

  it("keeps anything the server said nothing about, so a dropped reply loses no work", () => {
    const after = acknowledge(sent(), [{ commandId: "cmd-1", status: "accepted" }]);

    expect(after.pending.map((entry) => entry.commandId)).toEqual(["cmd-2"]);
  });

  it("never reuses a sequence after entries are acknowledged", () => {
    const after = acknowledge(sent(), [
      { commandId: "cmd-1", status: "accepted" },
      { commandId: "cmd-2", status: "accepted" },
    ]);

    expect(enqueue(after, tap(3)).pending[0]?.deviceSequence).toBe(3);
  });
});
