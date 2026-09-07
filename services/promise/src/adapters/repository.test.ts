import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresPromises } from "./repository.js";
import { makePromise, updateEta } from "../domain/promise.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_promise",
});
const repository = postgresPromises(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";
const consignmentId = "01J8Z0T0000000000000000003";
const at = new Date("2026-09-07T10:00:00.000Z");

const sample = () =>
  makePromise({
    consignmentId,
    tenantId,
    windowStart: new Date("2026-09-07T14:00:00.000Z"),
    windowEnd: new Date("2026-09-07T16:00:00.000Z"),
    at,
  });

beforeEach(async () => {
  await pool.query(
    "DROP TABLE IF EXISTS notifications, promises, aggregate_streams, schema_migrations CASCADE",
  );
  await migrate(pool, migrations);
});

afterAll(async () => {
  await pool.end();
});

describe("the promise repository", () => {
  it("round-trips a promise", async () => {
    await repository.save(sample());

    expect(await repository.byConsignment(tenantId, consignmentId)).toEqual(sample());
  });

  it("keeps the estimate and the risk flag when they change", async () => {
    await repository.save(sample());
    const late = updateEta(sample(), { eta: new Date("2026-09-07T18:00:00.000Z"), at });

    await repository.save(late);
    const stored = await repository.byConsignment(tenantId, consignmentId);

    expect(stored?.atRisk).toBe(true);
    expect(stored?.estimatedArrival).toEqual(new Date("2026-09-07T18:00:00.000Z"));
  });

  it("remembers what the customer was last told, even after a quiet update", async () => {
    const late = updateEta(sample(), { eta: new Date("2026-09-07T18:00:00.000Z"), at });
    await repository.save(late);

    const quiet = updateEta(late, { eta: new Date("2026-09-07T18:05:00.000Z"), at });
    await repository.save(quiet);

    expect((await repository.byConsignment(tenantId, consignmentId))?.lastNotifiedEta).toEqual(
      new Date("2026-09-07T18:00:00.000Z"),
    );
  });

  it("keeps one tenant's promises invisible to another", async () => {
    await repository.save(sample());

    expect(await repository.byConsignment("other", consignmentId)).toBeUndefined();
  });

  it("refuses a window that is not a window", async () => {
    await expect(
      repository.save({
        ...sample(),
        windowEnd: new Date("2026-09-07T13:00:00.000Z"),
      }),
    ).rejects.toThrow();
  });

  it("records what was sent and what failed", async () => {
    await repository.save(sample());
    await repository.recordNotification({
      id: "n-1",
      tenantId,
      consignmentId,
      channel: "whatsapp",
      template: "running_late",
      locale: "en-IN",
      sentAt: at,
    });
    await repository.recordNotification({
      id: "n-2",
      tenantId,
      consignmentId,
      channel: "whatsapp",
      template: "delivered",
      locale: "en-IN",
      failedReason: "provider unreachable",
    });

    const recorded = await repository.notificationsFor(tenantId, consignmentId);

    expect(recorded).toHaveLength(2);
    expect(recorded[1]?.failedReason).toBe("provider unreachable");
  });

  it("keeps one tenant's message history out of another's", async () => {
    await repository.save(sample());
    await repository.recordNotification({
      id: "n-1",
      tenantId,
      consignmentId,
      channel: "whatsapp",
      template: "delivered",
      locale: "en-IN",
      sentAt: at,
    });

    expect(await repository.notificationsFor("other", consignmentId)).toHaveLength(0);
  });

  it("hands out stream positions that never repeat", async () => {
    expect([
      await repository.nextSequence(tenantId, "a"),
      await repository.nextSequence(tenantId, "a"),
    ]).toEqual([1, 2]);
  });
});
