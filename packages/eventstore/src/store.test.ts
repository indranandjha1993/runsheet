import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { envelope } from "@runsheet/kernel";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { eventStore } from "./store.js";

const pool = new Pool({
  host: "localhost",
  port: 15432,
  user: "runsheet",
  password: "runsheet",
  database: "execution",
});

const store = eventStore(pool);
const tenantId = "01J8Z0T0000000000000000001";
const runId = "01J8Z0T0000000000000000009";

function runEvent(sequence: number, type: string): ReturnType<typeof envelope> {
  const at = new Date("2026-09-07T10:00:00.000Z");
  return envelope({
    tenantId,
    aggregateType: "run",
    aggregateId: runId,
    sequence,
    type,
    version: 1,
    occurredAt: at,
    recordedAt: at,
    source: "api",
  });
}

beforeEach(async () => {
  await pool.query(readFileSync(new URL("../migrations/001-events.sql", import.meta.url), "utf8"));
  await pool.query("TRUNCATE outbox, events");
});

afterAll(async () => {
  await pool.end();
});

describe("event store", () => {
  it("appends an event and queues it for publication in one transaction", async () => {
    await store.append(runEvent(1, "run.planned"), { hubId: "hub-1" }, "run");

    const stream = await store.readStream(tenantId, runId);
    expect(stream).toHaveLength(1);
    expect(stream[0]?.type).toBe("run.planned");
    expect(stream[0]?.payload).toEqual({ hubId: "hub-1" });

    const pending = await store.pendingOutbox(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.topic).toBe("run");
    expect(pending[0]?.partitionKey).toBe(`${tenantId}:${runId}`);
  });

  it("refuses a second event at the same stream position", async () => {
    await store.append(runEvent(1, "run.planned"), {}, "run");

    await expect(store.append(runEvent(1, "run.assigned"), {}, "run")).rejects.toThrow(
      "stream position 1 already taken",
    );
  });

  it("leaves nothing behind when the append fails", async () => {
    await store.append(runEvent(1, "run.planned"), {}, "run");
    await store.append(runEvent(1, "run.assigned"), {}, "run").catch(() => undefined);

    expect(await store.readStream(tenantId, runId)).toHaveLength(1);
    expect(await store.pendingOutbox(10)).toHaveLength(1);
  });

  it("returns the stream in sequence order for replay", async () => {
    await store.append(runEvent(2, "run.assigned"), {}, "run");
    await store.append(runEvent(1, "run.planned"), {}, "run");
    await store.append(runEvent(3, "run.started"), {}, "run");

    expect((await store.readStream(tenantId, runId)).map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it("stops handing out an event once it has been marked published", async () => {
    await store.append(runEvent(1, "run.planned"), {}, "run");
    const pending = await store.pendingOutbox(10);
    const first = pending[0];
    if (first === undefined) throw new Error("expected a pending message");

    await store.markPublished([first.eventId]);

    expect(await store.pendingOutbox(10)).toHaveLength(0);
  });

  it("keeps one tenant's stream out of another's", async () => {
    await store.append(runEvent(1, "run.planned"), {}, "run");
    const other = { ...runEvent(1, "run.planned"), tenantId: "01J8Z0T0000000000000000099" };
    await store.append(other, {}, "run");

    expect(await store.readStream(tenantId, runId)).toHaveLength(1);
  });
});
