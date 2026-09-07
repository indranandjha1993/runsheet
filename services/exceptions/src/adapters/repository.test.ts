import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresExceptions } from "./repository.js";
import { applyToException, raise } from "../domain/exception.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_exceptions",
});
const repository = postgresExceptions(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";
const at = new Date("2026-09-07T10:00:00.000Z");

const sample = () =>
  raise({
    id: "01J8Z0T0000000000000000010",
    tenantId,
    type: "cash_variance",
    subjectType: "run",
    subjectId: "run-1",
    detail: { shortfallMinor: 2500 },
    at,
  });

beforeEach(async () => {
  await pool.query("DROP TABLE IF EXISTS exceptions, aggregate_streams, schema_migrations CASCADE");
  await migrate(pool, migrations);
});

afterAll(async () => {
  await pool.end();
});

describe("the exceptions repository", () => {
  it("round-trips an exception with its clock", async () => {
    await repository.save(sample());

    expect(await repository.byId(tenantId, sample().id)).toEqual(sample());
  });

  it("round-trips one whose clock is paused", async () => {
    const waiting = applyToException(sample(), { type: "waiting_on_customer", at });

    await repository.save(waiting);

    expect(await repository.byId(tenantId, sample().id)).toEqual(waiting);
  });

  it("round-trips a resolved one with its note", async () => {
    const resolved = applyToException(sample(), {
      type: "resolved",
      by: "u1",
      note: "recounted at the depot",
      at,
    });

    await repository.save(resolved);

    expect(await repository.byId(tenantId, sample().id)).toEqual(resolved);
  });

  it("finds the open exception for a problem on a subject", async () => {
    await repository.save(sample());

    expect((await repository.openFor(tenantId, "cash_variance", "run-1"))?.id).toBe(sample().id);
    expect(await repository.openFor(tenantId, "cash_variance", "run-2")).toBeUndefined();
  });

  it("stops finding it once it is resolved, so the problem can recur", async () => {
    await repository.save(
      applyToException(sample(), { type: "resolved", by: "u", note: "done", at }),
    );

    expect(await repository.openFor(tenantId, "cash_variance", "run-1")).toBeUndefined();
  });

  it("refuses two open exceptions for the same problem on the same subject", async () => {
    await repository.save(sample());

    await expect(
      repository.save({ ...sample(), id: "01J8Z0T0000000000000000099" }),
    ).rejects.toThrow();
  });

  it("allows a new one after the first was resolved", async () => {
    await repository.save(
      applyToException(sample(), { type: "resolved", by: "u", note: "done", at }),
    );

    await expect(
      repository.save({ ...sample(), id: "01J8Z0T0000000000000000099" }),
    ).resolves.toBeUndefined();
  });

  it("returns the queue worst first", async () => {
    await repository.save(sample());
    await repository.save(
      raise({
        ...sample(),
        id: "01J8Z0T0000000000000000011",
        type: "address_unclear",
        subjectId: "a-1",
        at,
      }),
    );
    await repository.save(
      raise({
        ...sample(),
        id: "01J8Z0T0000000000000000012",
        type: "parcel_damaged",
        subjectId: "c-1",
        at,
      }),
    );

    expect((await repository.queue(tenantId)).map((e) => e.severity)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });

  it("can filter the queue to one severity", async () => {
    await repository.save(sample());
    await repository.save(
      raise({
        ...sample(),
        id: "01J8Z0T0000000000000000011",
        type: "address_unclear",
        subjectId: "a-1",
        at,
      }),
    );

    expect(await repository.queue(tenantId, "high")).toHaveLength(1);
  });

  it("keeps one tenant's queue out of another's", async () => {
    await repository.save(sample());

    expect(await repository.queue("other")).toHaveLength(0);
    expect(await repository.byId("other", sample().id)).toBeUndefined();
  });

  it("hands out stream positions that never repeat", async () => {
    expect([
      await repository.nextSequence(tenantId, "a"),
      await repository.nextSequence(tenantId, "a"),
    ]).toEqual([1, 2]);
  });
});
