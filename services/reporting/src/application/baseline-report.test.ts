import { describe, expect, it } from "vitest";
import { compareWindows, METRICS, metricNamed } from "./baseline-report.js";
import type { ReportingDeps, WindowCounts } from "./ports.js";

const counts = (count: number, events: number): WindowCounts => ({ count, events });

function depsReturning(baseline: WindowCounts, measured: WindowCounts): ReportingDeps {
  const answers = [baseline, measured];
  return {
    repository: {
      run: () => Promise.resolve({ columns: [], rows: [] }),
      countWindow: () => Promise.resolve(answers.shift() ?? counts(0, 0)),
    },
    clock: { now: () => new Date("2026-09-07T18:00:00.000Z") },
  };
}

const command = {
  tenantId: "t",
  metric: "failed_attempt_rate",
  baseline: { from: "2026-08-01", to: "2026-08-14" },
  measured: { from: "2026-08-15", to: "2026-08-28" },
};

describe("the metrics a baseline can be taken on", () => {
  it("covers what a buyer actually pays for", () => {
    expect(METRICS.map((metric) => metric.name)).toEqual([
      "failed_attempt_rate",
      "return_rate",
      "hub_exception_rate",
    ]);
  });

  it("says which way is better, so nobody reads a drop as a win by accident", () => {
    for (const metric of METRICS) expect(metric.betterWhen).toBe("lower");
  });

  it("finds one by name and nothing for a name nobody defined", () => {
    expect(metricNamed("return_rate")?.name).toBe("return_rate");
    expect(metricNamed("profit")).toBeUndefined();
  });
});

describe("comparing two windows", () => {
  it("reports the comparison with the windows it used", async () => {
    const result = await compareWindows(
      depsReturning(counts(2000, 400), counts(2000, 200)),
      command,
    );

    expect(result.metric).toBe("failed_attempt_rate");
    expect(result.verdict).toBe("improved");
    expect(result.baseline).toMatchObject({ from: "2026-08-01", count: 2000 });
  });

  it("holds back a verdict when there were not enough deliveries", async () => {
    const result = await compareWindows(depsReturning(counts(50, 10), counts(50, 2)), command);

    expect(result.verdict).toBe("not_enough_evidence");
  });

  it("refuses a metric nobody defined rather than measuring nothing", async () => {
    await expect(
      compareWindows(depsReturning(counts(2000, 400), counts(2000, 200)), {
        ...command,
        metric: "profit",
      }),
    ).rejects.toThrow("no baseline metric called profit");
  });

  it("refuses windows that overlap, because the same days would count twice", async () => {
    await expect(
      compareWindows(depsReturning(counts(2000, 400), counts(2000, 200)), {
        ...command,
        measured: { from: "2026-08-10", to: "2026-08-28" },
      }),
    ).rejects.toThrow("the two windows overlap");
  });

  it("refuses a measured window that ends before the baseline starts", async () => {
    await expect(
      compareWindows(depsReturning(counts(2000, 400), counts(2000, 200)), {
        ...command,
        baseline: { from: "2026-08-15", to: "2026-08-28" },
        measured: { from: "2026-08-01", to: "2026-08-14" },
      }),
    ).rejects.toThrow("the baseline must come first");
  });
});
