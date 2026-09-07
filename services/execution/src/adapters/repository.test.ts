import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresExecution } from "./repository.js";
import { applyToRun, plannedRun, type Run } from "../domain/run.js";
import { plannedStop } from "../domain/stop.js";
import { capture } from "../domain/proof.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_execution",
});
const repository = postgresExecution(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";

const sample = (): Run =>
  plannedRun({
    id: "01J8Z0T0000000000000000010",
    tenantId,
    hubId: "hub-1",
    date: "2026-09-07",
    stops: [
      plannedStop({
        id: "01J8Z0T0000000000000000020",
        sequence: 1,
        actions: [{ id: "01J8Z0T0000000000000000030", kind: "deliver", consignmentId: "c1" }],
      }),
      plannedStop({
        id: "01J8Z0T0000000000000000021",
        sequence: 2,
        actions: [{ id: "01J8Z0T0000000000000000031", kind: "pickup", consignmentId: "c2" }],
      }),
    ],
  });

beforeEach(async () => {
  await pool.query(
    "DROP TABLE IF EXISTS stop_actions, stops, runs, proofs, hub_scans, aggregate_streams, schema_migrations CASCADE",
  );
  await migrate(pool, migrations);
});

afterAll(async () => {
  await pool.end();
});

describe("the execution repository", () => {
  it("round-trips a run with its stops and actions", async () => {
    await repository.saveRun(sample(), 0);

    const found = await repository.runById(tenantId, sample().id);

    expect(found?.run).toEqual(sample());
    expect(found?.version).toBe(1);
  });

  it("keeps one tenant's runs invisible to another", async () => {
    await repository.saveRun(sample(), 0);

    expect(await repository.runById("other", sample().id)).toBeUndefined();
  });

  it("stores what happened at a stop, including the cash", async () => {
    await repository.saveRun(sample(), 0);
    let run = applyToRun(sample(), { type: "assigned", workerId: "w1", vehicleId: "v1" });
    run = applyToRun(run, { type: "started" });
    run = applyToRun(run, {
      type: "action_recorded",
      stopId: "01J8Z0T0000000000000000020",
      action: {
        actionId: "01J8Z0T0000000000000000030",
        result: "done",
        proofId: "p1",
        cashCollectedMinor: 24990,
      },
    });

    await repository.saveRun(run, 1);
    const found = await repository.runById(tenantId, run.id);

    expect(found?.run.stops[0]?.actions[0]).toMatchObject({
      result: "done",
      proofId: "p1",
      cashCollectedMinor: 24990,
    });
  });

  it("refuses a write when someone else changed the run first", async () => {
    await repository.saveRun(sample(), 0);
    const moved = applyToRun(sample(), { type: "assigned", workerId: "w", vehicleId: "v" });
    await repository.saveRun(moved, 1);

    await expect(repository.saveRun(moved, 1)).rejects.toThrow(/changed while it was/);
  });

  it("removes a stop that was moved to another run", async () => {
    await repository.saveRun(sample(), 0);
    const withoutSecond = applyToRun(sample(), {
      type: "stop_moved",
      stopId: "01J8Z0T0000000000000000021",
      toRunId: "run-2",
    });

    await repository.saveRun(withoutSecond, 1);

    const found = await repository.runById(tenantId, sample().id);
    expect(found?.run.stops.map((s) => s.id)).toEqual(["01J8Z0T0000000000000000020"]);
  });

  it("lists the open runs for a hub on a day and leaves closed ones out", async () => {
    await repository.saveRun(sample(), 0);
    const closed = { ...sample(), id: "01J8Z0T0000000000000000011", status: "closed" as const };
    await repository.saveRun(closed, 0);

    const open = await repository.openRuns(tenantId, "hub-1", "2026-09-07");

    expect(open.map((r) => r.id)).toEqual([sample().id]);
    expect(await repository.openRuns(tenantId, "hub-1", "2026-09-08")).toHaveLength(0);
  });

  it("round-trips a proof with everything needed to judge it later", async () => {
    const proof = capture({
      id: "01J8Z0T0000000000000000040",
      tenantId,
      consignmentId: "c1",
      requirement: "photo_and_otp",
      kinds: ["photo", "otp"],
      capturedAt: new Date("2026-09-07T10:00:00.000Z"),
      mediaIds: ["m1", "m2"],
      geofenceOk: true,
    });

    await repository.saveProof(proof);

    expect(await repository.proofById(tenantId, proof.id)).toEqual(proof);
  });

  it("round-trips a proof that had no media and no geofence", async () => {
    const proof = capture({
      id: "01J8Z0T0000000000000000041",
      tenantId,
      consignmentId: "c2",
      requirement: "none",
      kinds: [],
      capturedAt: new Date("2026-09-07T10:00:00.000Z"),
      mediaIds: [],
    });

    await repository.saveProof(proof);

    expect(await repository.proofById(tenantId, proof.id)).toEqual(proof);
  });

  it("reports a proof nobody stored", async () => {
    expect(await repository.proofById(tenantId, "nope")).toBeUndefined();
  });

  it("hands out stream positions that never repeat", async () => {
    expect([
      await repository.nextSequence(tenantId, "a"),
      await repository.nextSequence(tenantId, "a"),
      await repository.nextSequence(tenantId, "b"),
    ]).toEqual([1, 2, 1]);
  });
});

describe("hub scans in the database", () => {
  const scan = {
    tenantId,
    hubId: "hub-1",
    workerId: "w1",
    consignmentId: "c1",
    at: new Date("2026-09-07T10:00:00.000Z"),
    accepted: true,
  };

  it("reads back a scan with its measurements", async () => {
    await repository.saveScan(
      "01J8Z0T0000000000000000050",
      { ...scan, weightGrams: 1500, volumetricGrams: 1200 },
      "in",
    );

    const history = await repository.scansFor(tenantId, "c1");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ weightGrams: 1500, volumetricGrams: 1200, hubId: "hub-1" });
  });

  it("orders the history the way the parcel travelled", async () => {
    await repository.saveScan(
      "01J8Z0T0000000000000000051",
      { ...scan, hubId: "hub-2", at: new Date("2026-09-07T14:00:00.000Z") },
      "in",
    );
    await repository.saveScan("01J8Z0T0000000000000000050", scan, "in");

    const history = await repository.scansFor(tenantId, "c1");
    expect(history.map((s) => s.hubId)).toEqual(["hub-1", "hub-2"]);
  });

  it("keeps a refused outscan with its reason, because the parcel was physically presented", async () => {
    await repository.saveScan(
      "01J8Z0T0000000000000000052",
      { ...scan, accepted: false, exception: "not_on_this_run" },
      "out",
      "run-1",
    );

    const history = await repository.scansFor(tenantId, "c1");
    expect(history[0]).toMatchObject({ accepted: false, exception: "not_on_this_run" });
  });

  it("refuses an outscan row that names no run", async () => {
    await expect(repository.saveScan("01J8Z0T0000000000000000053", scan, "out")).rejects.toThrow(
      /hub_scans_outscan_names_a_run/,
    );
  });

  it("keeps one tenant's scans away from another", async () => {
    await repository.saveScan("01J8Z0T0000000000000000054", { ...scan, tenantId: "other" }, "in");

    expect(await repository.scansFor(tenantId, "c1")).toEqual([]);
  });
});
