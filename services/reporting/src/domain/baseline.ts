import { DomainError } from "./errors.js";

// A value claim that says "we improved failed attempts by a fifth" without saying whether that
// could have been luck is an anecdote. Everything here reports an interval, and refuses to call
// anything an improvement when the interval includes no change at all.

// The sample that gives a five per cent margin at 95 per cent confidence on a proportion.
// Below it, a comparison says more about the sample than about the operation.
export const MINIMUM_SAMPLE = 384;

// 95%, two-sided.
const Z = 1.96;

export type Verdict = "improved" | "worsened" | "indistinguishable" | "not_enough_evidence";

export interface Window {
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly events: number;
}

export interface Sample {
  readonly from: string;
  readonly to: string;
  readonly mean: number;
  readonly deviation: number;
  readonly count: number;
}

export interface Interval {
  readonly low: number;
  readonly high: number;
}

export interface Comparison {
  readonly baselineRate: number;
  readonly measuredRate: number;
  readonly difference: number;
  readonly interval: Interval;
  readonly verdict: Verdict;
  readonly note: string;
}

// An interval that includes zero includes "nothing changed". Whatever the point estimate says,
// that is not a result anybody should put in front of a buyer.
function judge(interval: Interval): Verdict {
  if (interval.low > 0) return "worsened";
  if (interval.high < 0) return "improved";
  return "indistinguishable";
}

function tooSmall(counts: readonly number[]): boolean {
  return counts.some((count) => count < MINIMUM_SAMPLE);
}

const NOT_ENOUGH = `fewer than ${String(MINIMUM_SAMPLE)} deliveries in a window; no comparison is worth making`;

export function compareRates(baseline: Window, measured: Window): Comparison {
  for (const window of [baseline, measured]) {
    if (window.events > window.count) {
      throw new DomainError("invalid_input", "a window cannot have more events than deliveries");
    }
  }

  const baselineRate = baseline.count === 0 ? 0 : baseline.events / baseline.count;
  const measuredRate = measured.count === 0 ? 0 : measured.events / measured.count;
  const difference = measuredRate - baselineRate;

  if (tooSmall([baseline.count, measured.count])) {
    return {
      baselineRate,
      measuredRate,
      difference,
      interval: { low: -1, high: 1 },
      verdict: "not_enough_evidence",
      note: NOT_ENOUGH,
    };
  }

  const spread = Math.sqrt(
    (baselineRate * (1 - baselineRate)) / baseline.count +
      (measuredRate * (1 - measuredRate)) / measured.count,
  );
  const margin = Z * spread;
  const interval = { low: difference - margin, high: difference + margin };

  return {
    baselineRate,
    measuredRate,
    difference,
    interval,
    verdict: judge(interval),
    note: "compared as two proportions, 95 per cent interval",
  };
}

export interface MeanComparison {
  readonly baselineMean: number;
  readonly measuredMean: number;
  readonly difference: number;
  readonly interval: Interval;
  readonly verdict: Verdict;
  readonly note: string;
}

export function compareMeans(baseline: Sample, measured: Sample): MeanComparison {
  for (const sample of [baseline, measured]) {
    if (sample.deviation < 0) {
      throw new DomainError("invalid_input", "a spread cannot be negative");
    }
  }

  const difference = measured.mean - baseline.mean;

  if (tooSmall([baseline.count, measured.count])) {
    return {
      baselineMean: baseline.mean,
      measuredMean: measured.mean,
      difference,
      interval: { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY },
      verdict: "not_enough_evidence",
      note: NOT_ENOUGH,
    };
  }

  const spread = Math.sqrt(
    baseline.deviation ** 2 / baseline.count + measured.deviation ** 2 / measured.count,
  );
  const margin = Z * spread;
  const interval = { low: difference - margin, high: difference + margin };

  return {
    baselineMean: baseline.mean,
    measuredMean: measured.mean,
    difference,
    interval,
    verdict: judge(interval),
    note: "compared as two means, 95 per cent interval",
  };
}
