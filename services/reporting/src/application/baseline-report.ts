import { compareRates, type Comparison } from "../domain/baseline.js";
import { DomainError } from "../domain/errors.js";
import type { ReportingDeps } from "./ports.js";

// The metrics a value claim is made on. Each is a rate over deliveries, so the same comparison
// applies to all of them and none of them can be argued about separately.
export interface Metric {
  readonly name: string;
  readonly description: string;
  readonly eventColumn: string;
  readonly countColumn: string;
  readonly betterWhen: "lower";
}

export const METRICS: readonly Metric[] = [
  {
    name: "failed_attempt_rate",
    description: "Deliveries attempted and not completed, as a share of all attempts.",
    eventColumn: "attempted",
    countColumn: "delivered + attempted",
    betterWhen: "lower",
  },
  {
    name: "return_rate",
    description: "Consignments that went back, as a share of everything that moved.",
    eventColumn: "returned",
    countColumn: "delivered + attempted + returned",
    betterWhen: "lower",
  },
  {
    name: "hub_exception_rate",
    description: "Parcels that raised something at a hub, as a share of everything scanned.",
    eventColumn: "exceptions",
    countColumn: "scanned_in",
    betterWhen: "lower",
  },
];

export function metricNamed(name: string): Metric | undefined {
  return METRICS.find((metric) => metric.name === name);
}

export interface Range {
  readonly from: string;
  readonly to: string;
}

export interface CompareCommand {
  readonly tenantId: string;
  readonly metric: string;
  readonly baseline: Range;
  readonly measured: Range;
  readonly lane?: string;
}

export interface WindowSummary extends Range {
  readonly count: number;
  readonly events: number;
  readonly rate: number;
}

export interface BaselineComparison extends Comparison {
  readonly metric: string;
  readonly betterWhen: "lower";
  readonly baseline: WindowSummary;
  readonly measured: WindowSummary;
}

function assertOrdered(command: CompareCommand): void {
  if (Date.parse(command.measured.from) < Date.parse(command.baseline.from)) {
    throw new DomainError("invalid_input", "the baseline must come first");
  }
  // Overlapping windows count the same days on both sides of the comparison, which flatters
  // whichever side is worse.
  if (Date.parse(command.measured.from) <= Date.parse(command.baseline.to)) {
    throw new DomainError("invalid_input", "the two windows overlap");
  }
}

export async function compareWindows(
  deps: ReportingDeps,
  command: CompareCommand,
): Promise<BaselineComparison> {
  const metric = metricNamed(command.metric);
  if (metric === undefined) {
    throw new DomainError("not_found", `no baseline metric called ${command.metric}`);
  }
  assertOrdered(command);

  const lane = command.lane;
  const before = await deps.repository.countWindow(command.tenantId, metric, {
    ...command.baseline,
    ...(lane === undefined ? {} : { lane }),
  });
  const after = await deps.repository.countWindow(command.tenantId, metric, {
    ...command.measured,
    ...(lane === undefined ? {} : { lane }),
  });

  const comparison = compareRates(
    { ...command.baseline, ...before },
    { ...command.measured, ...after },
  );

  return {
    ...comparison,
    metric: metric.name,
    betterWhen: metric.betterWhen,
    baseline: { ...command.baseline, ...before, rate: comparison.baselineRate },
    measured: { ...command.measured, ...after, rate: comparison.measuredRate },
  };
}
