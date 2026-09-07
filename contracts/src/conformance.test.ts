import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { envelope } from "@runsheet/kernel";
import { eventStore } from "@runsheet/eventstore";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { eventCatalogue, parseEvent, topicFor } from "./events.js";

const pool = new Pool({
  host: "localhost",
  port: 15432,
  user: "runsheet",
  password: "runsheet",
  database: "orders_consignments",
});
const store = eventStore(pool);
const migration = new URL("../../packages/eventstore/migrations/001-events.sql", import.meta.url);

const tenantId = "01J8Z0T0000000000000000001";
const consignmentId = "01J8Z0T0000000000000000003";
const at = new Date("2026-09-07T10:00:00.000Z");

beforeEach(async () => {
  await pool.query("DROP TABLE IF EXISTS outbox, events");
  await pool.query(readFileSync(migration, "utf8"));
});

afterAll(async () => {
  await pool.end();
});

describe("the store and the contracts agree", () => {
  it("stores an event that the contract accepts and reads it back unchanged", async () => {
    const event = envelope({
      tenantId,
      aggregateType: "consignment",
      aggregateId: consignmentId,
      sequence: 1,
      type: "consignment.booked",
      version: 1,
      occurredAt: at,
      recordedAt: at,
      source: "api",
    });
    const payload = {
      order_id: "01J8Z0T0000000000000000004",
      service: "next_day",
      payment_mode: "prepaid",
      guards: { proof_requirement: "photo", attempt_limit: 3 },
    };

    await store.append(event, payload, topicFor(event.type)?.topic ?? "unrouted");
    const stream = await store.readStream(tenantId, consignmentId);
    const stored = stream[0];
    if (stored === undefined) throw new Error("expected the event to be stored");

    const validated = parseEvent({
      event_id: stored.eventId,
      tenant_id: stored.tenantId,
      aggregate_type: stored.aggregateType,
      aggregate_id: stored.aggregateId,
      sequence: stored.sequence,
      type: stored.type,
      version: stored.version,
      occurred_at: stored.occurredAt.toISOString(),
      recorded_at: stored.recordedAt.toISOString(),
      source: stored.source,
      correlation_id: stored.correlationId,
      payload: stored.payload,
    });

    expect(validated.payload).toEqual(payload);
  });

  it("routes every catalogued event to a topic that exists", () => {
    const topics = new Set(
      Object.keys(eventCatalogue).map((type) => topicFor(type)?.topic ?? "unrouted"),
    );

    expect(topics.has("unrouted")).toBe(false);
    expect([...topics].sort()).toEqual([
      "address",
      "consignment",
      "exception",
      "network",
      "order",
      "plan",
      "promise",
      "run",
    ]);
  });

  it("names every event after the aggregate family that owns its topic", () => {
    const mismatched = Object.keys(eventCatalogue).filter((type) => {
      const prefix = type.split(".")[0] ?? "";
      const topic = topicFor(type)?.topic ?? "";
      const runFamily = ["run", "stop", "proof", "cash", "device"];
      const networkFamily = ["hub", "zone", "serviceability"];
      const promiseFamily = ["promise", "notification"];
      if (topic === "run") return !runFamily.includes(prefix);
      if (topic === "network") return !networkFamily.includes(prefix);
      if (topic === "promise") return !promiseFamily.includes(prefix);
      return prefix !== topic;
    });

    expect(mismatched).toEqual([]);
  });
});
