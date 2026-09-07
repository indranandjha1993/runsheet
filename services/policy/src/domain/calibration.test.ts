import { describe, expect, it } from "vitest";
import { calibrationOf } from "./calibration.js";

const outcome = (state: string, count: number): { state: string; count: number }[] =>
  Array.from({ length: count }, () => ({ state, count: 1 }));

describe("reporting how well a policy is calling it", () => {
  it("reports the share of decisions not undone", () => {
    const report = calibrationOf([
      ...outcome("executed", 95),
      ...outcome("reversed", 5),
    ]);

    expect(report.executed).toBe(100);
    expect(report.reversed).toBe(5);
    expect(report.precision).toBeCloseTo(0.95);
  });

  it("counts a failure against the policy too, because the customer felt it", () => {
    const report = calibrationOf([
      ...outcome("executed", 90),
      ...outcome("reversed", 5),
      ...outcome("failed", 5),
    ]);

    expect(report.precision).toBeCloseTo(0.9);
  });

  it("counts a rejected proposal against the policy, because a person had to fix it", () => {
    const report = calibrationOf([...outcome("executed", 90), ...outcome("rejected", 10)]);

    expect(report.rejected).toBe(10);
    expect(report.precision).toBeCloseTo(0.9);
  });

  it("ignores shadow decisions, which changed nothing", () => {
    const report = calibrationOf([
      ...outcome("executed", 10),
      ...outcome("shadow_recorded", 500),
    ]);

    expect(report.executed).toBe(10);
    expect(report.precision).toBe(1);
  });

  it("reports no confidence at all when there is nothing to judge", () => {
    const report = calibrationOf([]);

    expect(report.precision).toBeUndefined();
    expect(report.enoughToJudge).toBe(false);
  });

  it("says plainly when there are too few decisions to mean anything", () => {
    const report = calibrationOf([...outcome("executed", 10)]);

    expect(report.enoughToJudge).toBe(false);
    expect(report.precision).toBeCloseTo(1);
  });

  it("says there is enough once a hundred decisions have landed", () => {
    expect(calibrationOf(outcome("executed", 100)).enoughToJudge).toBe(true);
  });

  it("recommends rolling back when precision falls below the floor", () => {
    const report = calibrationOf([...outcome("executed", 80), ...outcome("reversed", 40)]);

    expect(report.recommendation).toBe("roll_back");
  });

  it("recommends holding when precision is fine but the sample is thin", () => {
    expect(calibrationOf(outcome("executed", 20)).recommendation).toBe("keep_watching");
  });

  it("recommends widening when it is doing well over enough decisions", () => {
    expect(calibrationOf(outcome("executed", 200)).recommendation).toBe("widen_rollout");
  });
});
