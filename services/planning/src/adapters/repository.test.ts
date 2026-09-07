import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresPlanning } from "./repository.js";
import type { PlannedRun } from "../application/ports.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_planning",
});
const repository = postgresPlanning(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";

const run = (id: string, vehicleId = "v1"): PlannedRun => ({
  id,
  tenantId,
  hubId: "hub-1",
  date: "2026-09-07",
  vehicleId,
  estimatedMinutes: 120,
  stops: [
    { sequence: 1, jobId: "c1" },
    { sequence: 2, jobId: "c2" },
  ],
});

beforeEach(async () => {
  await pool.query(
    "DROP TABLE IF EXISTS plan_stops, plans, aggregate_streams, schema_migrations CASCADE",
  );
  await migrate(pool, migrations);
});

afterAll(async () => {
  await pool.end();
});

describe("the planning repository", () => {
  it("round-trips a plan with its stops in order", async () => {
    await repository.savePlan([run("01J8Z0T0000000000000000010")], tenantId, "hub-1", "2026-09-07");

    const stored = await repository.planFor(tenantId, "hub-1", "2026-09-07");

    expect(stored).toEqual([run("01J8Z0T0000000000000000010")]);
  });

  it("keeps the date as the day it was, in any time zone", async () => {
    await repository.savePlan([run("01J8Z0T0000000000000000010")], tenantId, "hub-1", "2026-09-07");

    expect((await repository.planFor(tenantId, "hub-1", "2026-09-07"))[0]?.date).toBe("2026-09-07");
  });

  it("replaces the previous plan when a day is planned again", async () => {
    await repository.savePlan([run("01J8Z0T0000000000000000010")], tenantId, "hub-1", "2026-09-07");

    await repository.savePlan(
      [run("01J8Z0T0000000000000000011", "v2")],
      tenantId,
      "hub-1",
      "2026-09-07",
    );

    const stored = await repository.planFor(tenantId, "hub-1", "2026-09-07");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.vehicleId).toBe("v2");
  });

  it("keeps different days apart", async () => {
    await repository.savePlan([run("01J8Z0T0000000000000000010")], tenantId, "hub-1", "2026-09-07");
    await repository.savePlan(
      [{ ...run("01J8Z0T0000000000000000011"), date: "2026-09-08" }],
      tenantId,
      "hub-1",
      "2026-09-08",
    );

    expect(await repository.planFor(tenantId, "hub-1", "2026-09-07")).toHaveLength(1);
    expect(await repository.planFor(tenantId, "hub-1", "2026-09-08")).toHaveLength(1);
  });

  it("keeps one tenant's plans invisible to another", async () => {
    await repository.savePlan([run("01J8Z0T0000000000000000010")], tenantId, "hub-1", "2026-09-07");

    expect(await repository.planFor("other", "hub-1", "2026-09-07")).toHaveLength(0);
  });

  it("returns nothing for a day nobody planned", async () => {
    expect(await repository.planFor(tenantId, "hub-1", "2026-09-09")).toHaveLength(0);
  });

  it("refuses two stops claiming the same position on one run", async () => {
    const clashing = {
      ...run("01J8Z0T0000000000000000010"),
      stops: [
        { sequence: 1, jobId: "c1" },
        { sequence: 1, jobId: "c2" },
      ],
    };

    await expect(
      repository.savePlan([clashing], tenantId, "hub-1", "2026-09-07"),
    ).rejects.toThrow();
  });

  it("hands out stream positions that never repeat", async () => {
    expect([
      await repository.nextSequence(tenantId, "a"),
      await repository.nextSequence(tenantId, "a"),
    ]).toEqual([1, 2]);
  });
});
