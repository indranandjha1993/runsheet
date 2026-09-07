import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { envelope } from "@runsheet/kernel";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { idempotentConsumer } from "./consumer.js";
import type { StoredEvent } from "./store.js";

const pool = new Pool({
  host: "localhost",
  port: 15432,
  user: "runsheet",
  password: "runsheet",
  database: "test_consumer",
});

const tenantId = "01J8Z0T0000000000000000001";
const runId = "01J8Z0T0000000000000000009";

function stored(sequence: number, type: string): StoredEvent {
  const at = new Date("2026-09-07T10:00:00.000Z");
  return {
    ...envelope({
      tenantId,
      aggregateType: "run",
      aggregateId: runId,
      sequence,
      type,
      version: 1,
      occurredAt: at,
      recordedAt: at,
      source: "api",
    }),
    payload: {},
  };
}

beforeEach(async () => {
  await pool.query("DROP TABLE IF EXISTS consumer_watermarks, dead_letters");
  await pool.query(
    readFileSync(new URL("../migrations/002-consumers.sql", import.meta.url), "utf8"),
  );
});

afterAll(async () => {
  await pool.end();
});

describe("idempotent consumer", () => {
  it("handles an event once and remembers how far it has read", async () => {
    const seen: string[] = [];
    const consumer = idempotentConsumer(pool, "promise", (event) => {
      seen.push(event.type);
      return Promise.resolve();
    });

    await consumer.handle(stored(1, "run.planned"));

    expect(seen).toEqual(["run.planned"]);
    expect(await consumer.watermark(tenantId, runId)).toBe(1);
  });

  it("skips an event it has already handled, however often it is redelivered", async () => {
    const seen: string[] = [];
    const consumer = idempotentConsumer(pool, "promise", (event) => {
      seen.push(event.type);
      return Promise.resolve();
    });
    const event = stored(1, "run.planned");

    await consumer.handle(event);
    await consumer.handle(event);
    await consumer.handle(event);

    expect(seen).toEqual(["run.planned"]);
  });

  it("tracks each aggregate and each consumer separately", async () => {
    const promise = idempotentConsumer(pool, "promise", () => Promise.resolve());
    const exceptions = idempotentConsumer(pool, "exceptions", () => Promise.resolve());

    await promise.handle(stored(1, "run.planned"));

    expect(await promise.watermark(tenantId, runId)).toBe(1);
    expect(await exceptions.watermark(tenantId, runId)).toBe(0);
  });

  it("does not advance the watermark when the handler throws", async () => {
    const consumer = idempotentConsumer(pool, "promise", () =>
      Promise.reject(new Error("downstream unavailable")),
    );

    await expect(consumer.handle(stored(1, "run.planned"))).rejects.toThrow(
      "downstream unavailable",
    );
    expect(await consumer.watermark(tenantId, runId)).toBe(0);
  });

  it("dead-letters an event the handler rejects as unprocessable", async () => {
    const consumer = idempotentConsumer(pool, "promise", () =>
      Promise.reject(new Error("unknown event type")),
    );
    const event = stored(1, "run.planned");

    await consumer.deadLetter(event, "unknown event type");

    const letters = await consumer.deadLetters();
    expect(letters).toHaveLength(1);
    expect(letters[0]?.reason).toBe("unknown event type");
    expect(await consumer.watermark(tenantId, runId)).toBe(1);
  });

  it("parks an event that arrives before its predecessor", async () => {
    const seen: number[] = [];
    const consumer = idempotentConsumer(pool, "promise", (event) => {
      seen.push(event.sequence);
      return Promise.resolve();
    });

    const parked = await consumer.handle(stored(3, "run.started"));

    expect(parked).toBe("parked");
    expect(seen).toEqual([]);
    expect(await consumer.watermark(tenantId, runId)).toBe(0);
  });
});
