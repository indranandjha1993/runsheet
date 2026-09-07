import { beforeEach, describe, expect, it } from "vitest";
import { planDay } from "./plan-day.js";
import { nearestFirstPlanner } from "../adapters/nearest-first.js";
import { countingIds, fixedClock, inMemoryPlans, recordingPublisher } from "./test-doubles.js";
import type { Job, PlanningDeps, Vehicle } from "./ports.js";

const tenantId = "01J8Z0T0000000000000000002";
const hubLocation = { latitude: 12.9, longitude: 77.6 };

const van = (id: string, over: Partial<Vehicle> = {}): Vehicle => ({
  id,
  maxStops: 3,
  maxWeightGrams: 50_000,
  shiftMinutes: 480,
  ...over,
});

const job = (id: string, latitude: number): Job => ({
  id,
  weightGrams: 1000,
  serviceMinutes: 5,
  location: { latitude, longitude: 77.6 },
});

let deps: PlanningDeps & { publisher: ReturnType<typeof recordingPublisher> };

beforeEach(() => {
  deps = {
    repository: inMemoryPlans(),
    planner: nearestFirstPlanner(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T05:00:00.000Z"),
    ids: countingIds(),
  };
});

const command = {
  tenantId,
  hubId: "hub-1",
  hubLocation,
  date: "2026-09-07",
  vehicles: [van("v1")],
  jobs: [job("far", 13.1), job("near", 12.91), job("middle", 13.0)],
};

describe("planning a day", () => {
  it("builds a run with its stops in a sensible order", async () => {
    const plan = await planDay(deps, command);

    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]?.stops.map((s) => s.jobId)).toEqual(["near", "middle", "far"]);
  });

  it("numbers the stops from one", async () => {
    const plan = await planDay(deps, command);

    expect(plan.runs[0]?.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
  });

  it("estimates how long each run takes", async () => {
    const plan = await planDay(deps, command);

    expect(plan.runs[0]?.estimatedMinutes).toBeGreaterThan(0);
  });

  it("spreads work across vehicles when one cannot take it all", async () => {
    const plan = await planDay(deps, {
      ...command,
      vehicles: [van("v1", { maxStops: 2 }), van("v2")],
    });

    expect(plan.runs).toHaveLength(2);
    expect(plan.unassignedJobIds).toHaveLength(0);
  });

  it("keeps the nearest work and leaves the far outliers unplanned", async () => {
    const plan = await planDay(deps, {
      ...command,
      vehicles: [van("v1", { maxStops: 1 })],
    });

    expect(plan.runs[0]?.stops.map((s) => s.jobId)).toEqual(["near"]);
    expect(plan.unassignedJobIds).toEqual(["middle", "far"]);
    expect(deps.publisher.published[0]?.payload).toMatchObject({ unassigned: 2 });
  });

  it("announces what it planned", async () => {
    await planDay(deps, command);

    expect(deps.publisher.published[0]?.event.type).toBe("plan.completed");
    expect(deps.publisher.published[0]?.payload).toMatchObject({ runs: 1, stops_planned: 3 });
  });

  it("stores the plan so a dispatcher can read it back", async () => {
    await planDay(deps, command);

    const stored = await deps.repository.planFor(tenantId, "hub-1", "2026-09-07");

    expect(stored[0]?.stops).toHaveLength(3);
  });

  it("refuses to plan nothing", async () => {
    await expect(planDay(deps, { ...command, jobs: [] })).rejects.toThrow("there is nothing to plan");
  });

  it("plans nothing when there are no vehicles, and says so", async () => {
    const plan = await planDay(deps, { ...command, vehicles: [] });

    expect(plan.runs).toHaveLength(0);
    expect(plan.unassignedJobIds).toHaveLength(3);
  });

  it("gives the same plan for the same input, whatever order it arrives in", async () => {
    const forwards = await planDay(deps, command);
    const backwards = await planDay(
      { ...deps, repository: inMemoryPlans(), ids: countingIds() },
      { ...command, jobs: [...command.jobs].reverse() },
    );

    expect(forwards.runs[0]?.stops.map((s) => s.jobId)).toEqual(
      backwards.runs[0]?.stops.map((s) => s.jobId),
    );
  });
});
