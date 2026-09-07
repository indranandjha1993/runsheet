import { describe, expect, it } from "vitest";
import { plannedStop } from "./stop.js";
import {
  applyToRun,
  canClose,
  cashSummary,
  plannedRun,
  type Run,
} from "./run.js";

const stops = [
  plannedStop({ id: "s1", sequence: 1, actions: [{ id: "a1", kind: "deliver", consignmentId: "c1" }] }),
  plannedStop({ id: "s2", sequence: 2, actions: [{ id: "a2", kind: "deliver", consignmentId: "c2" }] }),
];

const run = (): Run =>
  plannedRun({ id: "run-1", tenantId: "t", hubId: "hub-1", date: "2026-09-07", stops });

describe("planning a run", () => {
  it("starts planned with its stops in sequence", () => {
    expect(run().status).toBe("planned");
    expect(run().stops.map((s) => s.sequence)).toEqual([1, 2]);
  });

  it("refuses a run with no stops", () => {
    expect(() =>
      plannedRun({ id: "r", tenantId: "t", hubId: "h", date: "2026-09-07", stops: [] }),
    ).toThrow("a run needs at least one stop");
  });

  it("refuses two stops claiming the same position", () => {
    expect(() =>
      plannedRun({
        id: "r",
        tenantId: "t",
        hubId: "h",
        date: "2026-09-07",
        stops: stops.map((stop) => ({ ...stop, sequence: 1 })),
      }),
    ).toThrow("two stops cannot share a position");
  });
});

describe("running a run", () => {
  it("goes from planned to closed through the usual path", () => {
    let current = applyToRun(run(), { type: "assigned", workerId: "w1", vehicleId: "v1" });
    current = applyToRun(current, { type: "started" });
    current = applyToRun(current, {
      type: "action_recorded",
      stopId: "s1",
      action: { actionId: "a1", result: "done", proofId: "p1" },
    });
    current = applyToRun(current, {
      type: "action_recorded",
      stopId: "s2",
      action: { actionId: "a2", result: "done", proofId: "p2" },
    });
    current = applyToRun(current, { type: "completed" });
    current = applyToRun(current, { type: "cash_declared", amountMinor: 0 });
    current = applyToRun(current, { type: "cash_counted", amountMinor: 0 });
    current = applyToRun(current, { type: "closed" });

    expect(current.status).toBe("closed");
  });

  it("will not start before someone is assigned to it", () => {
    expect(() => applyToRun(run(), { type: "started" })).toThrow(
      "a run that is planned cannot be started",
    );
  });

  it("will not complete while a stop is unresolved", () => {
    const started = applyToRun(
      applyToRun(run(), { type: "assigned", workerId: "w1", vehicleId: "v1" }),
      { type: "started" },
    );

    expect(() => applyToRun(started, { type: "completed" })).toThrow(
      "every stop must be resolved before a run is completed",
    );
  });

  it("lets a supervisor unassign a run that has not started", () => {
    const assigned = applyToRun(run(), { type: "assigned", workerId: "w1", vehicleId: "v1" });

    expect(applyToRun(assigned, { type: "unassigned" }).status).toBe("planned");
  });

  it("suspends and resumes when a driver stops mid-shift", () => {
    const started = applyToRun(
      applyToRun(run(), { type: "assigned", workerId: "w1", vehicleId: "v1" }),
      { type: "started" },
    );

    const suspended = applyToRun(started, { type: "suspended", reason: "vehicle_breakdown" });
    expect(suspended.status).toBe("suspended");
    expect(applyToRun(suspended, { type: "started" }).status).toBe("started");
  });

  it("moves the remaining stops off a suspended run", () => {
    const started = applyToRun(
      applyToRun(run(), { type: "assigned", workerId: "w1", vehicleId: "v1" }),
      { type: "started" },
    );
    const suspended = applyToRun(started, { type: "suspended", reason: "driver_ill" });

    const after = applyToRun(suspended, { type: "stop_moved", stopId: "s2", toRunId: "run-2" });

    expect(after.stops.map((s) => s.id)).toEqual(["s1"]);
  });
});

describe("closing a run", () => {
  const worked = (): Run => {
    let current = applyToRun(run(), { type: "assigned", workerId: "w1", vehicleId: "v1" });
    current = applyToRun(current, { type: "started" });
    current = applyToRun(current, {
      type: "action_recorded",
      stopId: "s1",
      action: { actionId: "a1", result: "done", proofId: "p1", cashCollectedMinor: 50000 },
    });
    current = applyToRun(current, {
      type: "action_recorded",
      stopId: "s2",
      action: { actionId: "a2", result: "failed", ndrReason: "nobody_home", proofId: "p2" },
    });
    return applyToRun(current, { type: "completed" });
  };

  it("adds up the cash the driver collected", () => {
    expect(cashSummary(worked()).collectedMinor).toBe(50000);
  });

  it("will not close before the cash is declared and counted", () => {
    expect(canClose(worked())).toBe(false);
    expect(() => applyToRun(worked(), { type: "closed" })).toThrow(
      "cash must be declared and counted before a run is closed",
    );
  });

  it("closes when the count matches what was collected", () => {
    let current = applyToRun(worked(), { type: "cash_declared", amountMinor: 50000 });
    current = applyToRun(current, { type: "cash_counted", amountMinor: 50000 });

    expect(canClose(current)).toBe(true);
    expect(applyToRun(current, { type: "closed" }).status).toBe("closed");
  });

  it("closes with a shortfall rather than trapping the driver, and reports the variance", () => {
    let current = applyToRun(worked(), { type: "cash_declared", amountMinor: 48000 });
    current = applyToRun(current, { type: "cash_counted", amountMinor: 47500 });

    const summary = cashSummary(current);
    expect(summary.varianceMinor).toBe(-2500);
    expect(applyToRun(current, { type: "closed" }).status).toBe("closed");
  });

  it("lets a supervisor force a run closed when a phone never syncs", () => {
    const forced = applyToRun(worked(), { type: "force_closed", reason: "device_lost" });

    expect(forced.status).toBe("closed");
    expect(forced.forcedClose).toBe(true);
  });
});

describe("things a supervisor does", () => {
  it("cancels a run before anyone starts it, freeing its stops", () => {
    expect(applyToRun(run(), { type: "cancelled" }).status).toBe("cancelled");
  });

  it("moves a stop off a run that has not started", () => {
    const after = applyToRun(run(), { type: "stop_moved", stopId: "s1", toRunId: "run-9" });

    expect(after.stops.map((s) => s.id)).toEqual(["s2"]);
  });

  it("refuses work against a stop the run does not have", () => {
    const started = applyToRun(
      applyToRun(run(), { type: "assigned", workerId: "w", vehicleId: "v" }),
      { type: "started" },
    );

    expect(() =>
      applyToRun(started, {
        type: "action_recorded",
        stopId: "nope",
        action: { actionId: "a1", result: "done", proofId: "p" },
      }),
    ).toThrow("this run has no stop nope");
  });

  it("reports no cash figures before anything is declared", () => {
    expect(cashSummary(run())).toEqual({ collectedMinor: 0 });
  });
});
