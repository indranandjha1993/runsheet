import { beforeEach, describe, expect, it } from "vitest";
import { MAX_BATCH_ENTRIES, syncBatch, type SyncBatchCommand } from "./sync.js";
import type { ExecutionDeps } from "./ports.js";
import { countingIds, fixedClock, inMemoryExecution, recordingPublisher } from "./test-doubles.js";

let deps: ExecutionDeps & { publisher: ReturnType<typeof recordingPublisher> };

beforeEach(() => {
  deps = {
    repository: inMemoryExecution(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T18:00:00.000Z"),
    ids: countingIds(),
  };
});

const entry = (n: number, type = "stop.completed"): SyncBatchCommand["entries"][number] => ({
  commandId: `cmd-${String(n)}`,
  deviceSequence: n,
  type,
  payload: { stop_id: `stop-${String(n)}`, consignment_id: `c-${String(n)}` },
  occurredAtDevice: new Date(`2026-09-07T17:0${String(n)}:00.000Z`),
  monotonicMs: 5 * 3_600_000 + n * 60_000,
  media: [],
});

const batch = (entries = [entry(1), entry(2)]): SyncBatchCommand => ({
  tenantId: "t",
  deviceId: "device-1",
  deviceBootId: "boot-1",
  workerId: "w1",
  runId: "run-1",
  batchId: "batch-1",
  clock: { deviceSentAt: new Date("2026-09-07T18:00:00.000Z"), monotonicNowMs: 6 * 3_600_000 },
  entries,
});

describe("taking a batch off a driver's handset", () => {
  it("accepts every entry and says so one by one", async () => {
    const result = await syncBatch(deps, batch());

    expect(result.results.map((r) => r.status)).toEqual(["accepted", "accepted"]);
    expect(result.results.map((r) => r.commandId)).toEqual(["cmd-1", "cmd-2"]);
  });

  it("gives each accepted entry the event identifier it became", async () => {
    const result = await syncBatch(deps, batch());

    for (const one of result.results) expect(one.eventId).toBeDefined();
  });

  it("reports the same batch sent twice as duplicate rather than doing it twice", async () => {
    await syncBatch(deps, batch());
    const again = await syncBatch(deps, { ...batch(), batchId: "batch-2" });

    expect(again.results.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
    expect(deps.publisher.published).toHaveLength(2);
  });

  it("takes the new entries out of a batch that partly arrived before", async () => {
    await syncBatch(deps, batch([entry(1)]));

    const second = await syncBatch(deps, { ...batch([entry(1), entry(2)]), batchId: "batch-2" });

    expect(second.results.map((r) => r.status)).toEqual(["duplicate", "accepted"]);
  });

  it("reads the batch in device order however it was packed", async () => {
    const result = await syncBatch(deps, batch([entry(3), entry(1), entry(2)]));

    expect(result.results.map((r) => r.commandId)).toEqual(["cmd-1", "cmd-2", "cmd-3"]);
  });

  it("refuses a batch bigger than a handset should ever send", async () => {
    const many = Array.from({ length: MAX_BATCH_ENTRIES + 1 }, (_, n) => entry(n + 1));

    await expect(syncBatch(deps, batch(many))).rejects.toThrow(
      "that batch is too large; split it on device sequence",
    );
  });

  it("refuses a batch with two entries claiming the same position", async () => {
    await expect(
      syncBatch(deps, batch([entry(1), { ...entry(2), deviceSequence: 1 }])),
    ).rejects.toThrow("two entries claim device sequence 1");
  });

  it("refuses an entry the platform has no event for", async () => {
    const result = await syncBatch(deps, batch([entry(1, "stop.teleported")]));

    expect(result.results[0]?.status).toBe("rejected");
    expect(result.results[0]?.reason).toContain("stop.teleported");
  });

  it("takes the good entries even when one beside them is rejected", async () => {
    const result = await syncBatch(deps, batch([entry(1), entry(2, "stop.teleported")]));

    expect(result.results.map((r) => r.status)).toEqual(["accepted", "rejected"]);
  });
});

describe("what the batch does to the times", () => {
  it("stamps a reconciled time and a confidence on every event", async () => {
    await syncBatch(deps, batch());

    for (const published of deps.publisher.published) {
      expect(published.event.confidence).toBe(1);
      expect(published.event.occurredAt).toBeInstanceOf(Date);
    }
  });

  it("marks the batch as coming from a device, not from the interface", async () => {
    await syncBatch(deps, batch());

    expect(deps.publisher.published[0]?.event.source).toBe("device");
  });

  it("holds back an entry older than the window instead of moving anything", async () => {
    const old = {
      ...entry(1),
      occurredAtDevice: new Date("2026-09-01T10:00:00.000Z"),
      monotonicMs: 1000,
    };

    const result = await syncBatch(deps, {
      ...batch([old]),
      clock: { deviceSentAt: new Date("2026-09-07T18:00:00.000Z"), monotonicNowMs: 6 * 3_600_000 },
      deviceBootId: "boot-9",
    });

    expect(result.results[0]?.status).toBe("accepted");
  });
});

describe("proof media in a batch", () => {
  it("records the manifest without waiting for a single byte", async () => {
    const withMedia = {
      ...entry(1),
      media: [{ mediaId: "m-1", sha256: "a".repeat(64), bytes: 120_000, kind: "photo" }],
    };

    const result = await syncBatch(deps, batch([withMedia]));

    expect(result.results[0]?.status).toBe("accepted");
    expect(result.uploads).toEqual([{ mediaId: "m-1", sha256: "a".repeat(64) }]);
  });

  it("asks for nothing when there is nothing to upload", async () => {
    const result = await syncBatch(deps, batch());

    expect(result.uploads).toEqual([]);
  });

  it("refuses a manifest entry with a hash that is not a hash", async () => {
    const bad = {
      ...entry(1),
      media: [{ mediaId: "m-1", sha256: "nope", bytes: 1, kind: "photo" }],
    };

    const result = await syncBatch(deps, batch([bad]));

    expect(result.results[0]?.status).toBe("rejected");
    expect(result.results[0]?.reason).toContain("hash");
  });
});
