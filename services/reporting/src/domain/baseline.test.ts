import { describe, expect, it } from "vitest";
import { compareRates, compareMeans, MINIMUM_SAMPLE, type Window } from "./baseline.js";

const window = (attempts: number, failures: number): Window => ({
  from: "2026-08-01",
  to: "2026-08-14",
  count: attempts,
  events: failures,
});

describe("comparing a rate against a baseline", () => {
  it("reports the two rates and the difference between them", () => {
    const result = compareRates(window(1000, 200), window(1000, 150));

    expect(result.baselineRate).toBeCloseTo(0.2, 3);
    expect(result.measuredRate).toBeCloseTo(0.15, 3);
    expect(result.difference).toBeCloseTo(-0.05, 3);
  });

  it("calls a large, clear improvement an improvement", () => {
    const result = compareRates(window(2000, 400), window(2000, 200));

    expect(result.verdict).toBe("improved");
    expect(result.interval.high).toBeLessThan(0);
  });

  it("calls a large, clear worsening a worsening", () => {
    const result = compareRates(window(2000, 200), window(2000, 400));

    expect(result.verdict).toBe("worsened");
    expect(result.interval.low).toBeGreaterThan(0);
  });

  it("refuses to call a small difference anything at all", () => {
    const result = compareRates(window(1000, 200), window(1000, 197));

    expect(result.verdict).toBe("indistinguishable");
  });

  it("says the interval straddles zero when the difference could be noise", () => {
    const result = compareRates(window(1000, 200), window(1000, 197));

    expect(result.interval.low).toBeLessThan(0);
    expect(result.interval.high).toBeGreaterThan(0);
  });

  it("refuses to judge anything on too few deliveries, however big the gap looks", () => {
    const result = compareRates(window(10, 5), window(10, 0));

    expect(result.verdict).toBe("not_enough_evidence");
  });

  it("says what it needs before it could judge", () => {
    const result = compareRates(window(10, 5), window(10, 0));

    expect(result.note).toContain(String(MINIMUM_SAMPLE));
  });

  it("refuses a window with no deliveries at all rather than dividing by zero", () => {
    const result = compareRates(window(0, 0), window(100, 10));

    expect(result.verdict).toBe("not_enough_evidence");
    expect(Number.isFinite(result.difference)).toBe(true);
  });

  it("refuses more events than there were deliveries, which is a broken measurement", () => {
    expect(() => compareRates(window(100, 200), window(100, 10))).toThrow(
      "a window cannot have more events than deliveries",
    );
  });
});

describe("comparing an average against a baseline", () => {
  const sample = (mean: number, deviation: number, count: number) => ({
    from: "2026-08-01",
    to: "2026-08-14",
    mean,
    deviation,
    count,
  });

  it("reports the difference between the two averages", () => {
    const result = compareMeans(sample(4200, 800, 1000), sample(3600, 800, 1000));

    expect(result.difference).toBeCloseTo(-600, 0);
  });

  it("calls a clear drop in cost an improvement", () => {
    const result = compareMeans(sample(4200, 800, 1000), sample(3600, 800, 1000));

    expect(result.verdict).toBe("improved");
  });

  it("calls a clear rise a worsening", () => {
    const result = compareMeans(sample(3600, 800, 1000), sample(4200, 800, 1000));

    expect(result.verdict).toBe("worsened");
  });

  it("refuses to call a difference smaller than the noise around it", () => {
    const result = compareMeans(sample(4200, 2000, 400), sample(4150, 2000, 400));

    expect(result.verdict).toBe("indistinguishable");
  });

  it("refuses to judge on too small a sample", () => {
    const result = compareMeans(sample(4200, 800, 5), sample(1000, 800, 5));

    expect(result.verdict).toBe("not_enough_evidence");
  });

  it("refuses a negative spread, which is a broken measurement", () => {
    expect(() => compareMeans(sample(4200, -1, 1000), sample(3600, 800, 1000))).toThrow(
      "a spread cannot be negative",
    );
  });
});
