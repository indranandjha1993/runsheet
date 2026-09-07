import { describe, expect, it } from "vitest";
import { nearestFirstPlanner } from "./nearest-first.js";
import type { Job } from "../domain/capacity.js";

const at = (latitude: number, longitude: number): Job["location"] => ({ latitude, longitude });

const job = (id: string, latitude: number, longitude: number): Job => ({
  id,
  weightGrams: 1000,
  serviceMinutes: 5,
  location: at(latitude, longitude),
});

const planner = nearestFirstPlanner();
const depot = at(12.9, 77.6);

describe("sequencing a run", () => {
  it("visits the nearest unvisited stop each time", async () => {
    const sequenced = await planner.sequence({
      from: depot,
      jobs: [job("far", 13.2, 77.6), job("near", 12.91, 77.6), job("middle", 13.0, 77.6)],
    });

    expect(sequenced.order.map((j) => j.id)).toEqual(["near", "middle", "far"]);
  });

  it("gives the same answer however the stops arrive", async () => {
    const jobs = [job("a", 12.91, 77.6), job("b", 13.0, 77.6), job("c", 13.2, 77.6)];

    const forwards = await planner.sequence({ from: depot, jobs });
    const backwards = await planner.sequence({ from: depot, jobs: [...jobs].reverse() });

    expect(forwards.order.map((j) => j.id)).toEqual(backwards.order.map((j) => j.id));
  });

  it("breaks a tie by identifier, so the plan never depends on input order", async () => {
    const sequenced = await planner.sequence({
      from: depot,
      jobs: [job("zulu", 12.91, 77.6), job("alpha", 12.91, 77.6)],
    });

    expect(sequenced.order[0]?.id).toBe("alpha");
  });

  it("estimates how long the run takes, including service time", async () => {
    const sequenced = await planner.sequence({
      from: depot,
      jobs: [job("a", 12.91, 77.6), job("b", 12.92, 77.6)],
    });

    expect(sequenced.estimatedMinutes).toBeGreaterThan(10);
  });

  it("handles a run with one stop", async () => {
    const sequenced = await planner.sequence({ from: depot, jobs: [job("only", 12.91, 77.6)] });

    expect(sequenced.order).toHaveLength(1);
  });

  it("handles a run with no stops rather than failing", async () => {
    const sequenced = await planner.sequence({ from: depot, jobs: [] });

    expect(sequenced.order).toHaveLength(0);
    expect(sequenced.estimatedMinutes).toBe(0);
  });

  it("keeps every stop it was given, losing none", async () => {
    const jobs = Array.from({ length: 20 }, (_v, i) =>
      job(`j${String(i)}`, 12.9 + i * 0.01, 77.6 + (i % 3) * 0.01),
    );

    const sequenced = await planner.sequence({ from: depot, jobs });

    expect(new Set(sequenced.order.map((j) => j.id)).size).toBe(20);
  });
});
