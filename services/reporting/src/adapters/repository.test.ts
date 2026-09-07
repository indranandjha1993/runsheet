import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresReporting } from "./repository.js";
import { REPORTS, reportNamed, type Report } from "../domain/reports.js";
import { metricNamed } from "../application/baseline-report.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_reporting",
});
const repository = postgresReporting(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";
const range = { from: "2026-09-01", to: "2026-09-30" };

function named(name: string): Report {
  const report = reportNamed(name);
  if (report === undefined) throw new Error(`no report called ${name}`);
  return report;
}

beforeEach(async () => {
  await pool.query(
    `DROP TABLE IF EXISTS consignment_outcomes, cash_positions, hub_activity, exception_ageing,
       linehaul_trips, schema_migrations CASCADE`,
  );
  await migrate(pool, migrations);
});

afterAll(async () => {
  await pool.end();
});

describe("every report the platform offers", () => {
  it("actually runs against the schema that ships with it", async () => {
    for (const report of REPORTS) {
      const result = await repository.run(report, tenantId, range);

      expect(result.rows).toEqual([]);
      expect(result.columns.length).toBeGreaterThan(1);
    }
  });

  it("runs with a hub narrowed down, where the report has hubs", async () => {
    const withHubs = REPORTS.filter((report) => report.hubColumn !== undefined);

    expect(withHubs.length).toBeGreaterThan(0);
    for (const report of withHubs) {
      await expect(
        repository.run(report, tenantId, { ...range, hub: "BLR1" }),
      ).resolves.toBeDefined();
    }
  });
});

describe("reading what the projections hold", () => {
  beforeEach(async () => {
    await pool.query(
      `INSERT INTO consignment_outcomes
         (tenant_id, occurred_on, hub_id, reason, delivered, attempted, returned)
       VALUES ($1, '2026-09-07', 'BLR1', '', 40, 3, 1),
              ($1, '2026-09-07', 'BLR1', 'customer_unavailable', 0, 5, 0),
              ($1, '2026-09-07', 'DEL3', '', 12, 1, 0),
              ('somebody-else', '2026-09-07', 'BLR1', '', 999, 0, 0)`,
      [tenantId],
    );
  });

  it("adds the day up across the rows behind it", async () => {
    const result = await repository.run(named("delivery_performance"), tenantId, range);
    const blr = result.rows.find((row) => row["hub_id"] === "BLR1");

    expect(blr).toMatchObject({ delivered: 40, attempted: 8, day: "2026-09-07" });
  });

  it("never shows another tenant's numbers", async () => {
    const result = await repository.run(named("delivery_performance"), tenantId, range);

    expect(result.rows.every((row) => Number(row["delivered"]) < 999)).toBe(true);
  });

  it("narrows to one hub when asked", async () => {
    const result = await repository.run(named("delivery_performance"), tenantId, {
      ...range,
      hub: "DEL3",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ hub_id: "DEL3" });
  });

  it("leaves out days outside the range", async () => {
    const result = await repository.run(named("delivery_performance"), tenantId, {
      from: "2026-08-01",
      to: "2026-08-31",
    });

    expect(result.rows).toEqual([]);
  });

  it("lists only the attempts that carried a reason", async () => {
    const result = await repository.run(named("failed_deliveries"), tenantId, range);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ reason: "customer_unavailable", attempts: 5 });
  });
});

describe("counting a window for a baseline", () => {
  beforeEach(async () => {
    await pool.query(
      `INSERT INTO consignment_outcomes
         (tenant_id, occurred_on, hub_id, reason, delivered, attempted, returned)
       VALUES ($1, '2026-08-05', 'BLR1', '', 400, 100, 20),
              ($1, '2026-08-20', 'BLR1', '', 450, 50, 10),
              ($1, '2026-08-20', 'DEL3', '', 200, 40, 5),
              ('somebody-else', '2026-08-05', 'BLR1', '', 999, 999, 999)`,
      [tenantId],
    );
  });

  const failedAttempts = metricNamed("failed_attempt_rate");

  it("adds up the window it was given and nothing outside it", async () => {
    if (failedAttempts === undefined) throw new Error("the metric is missing");

    const counts = await repository.countWindow(tenantId, failedAttempts, {
      from: "2026-08-01",
      to: "2026-08-14",
    });

    expect(counts).toEqual({ count: 500, events: 100 });
  });

  it("narrows to one hub when a lane is named", async () => {
    if (failedAttempts === undefined) throw new Error("the metric is missing");

    const counts = await repository.countWindow(tenantId, failedAttempts, {
      from: "2026-08-15",
      to: "2026-08-28",
      lane: "DEL3",
    });

    expect(counts).toEqual({ count: 240, events: 40 });
  });

  it("never counts another tenant's deliveries", async () => {
    if (failedAttempts === undefined) throw new Error("the metric is missing");

    const counts = await repository.countWindow("nobody", failedAttempts, {
      from: "2026-08-01",
      to: "2026-08-31",
    });

    expect(counts).toEqual({ count: 0, events: 0 });
  });
});
