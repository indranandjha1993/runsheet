import type { Cell } from "../domain/csv.js";
import type { Report, ReportParameters } from "../domain/reports.js";
import type { Metric } from "./baseline-report.js";

export interface ReportResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, Cell>[];
}

export interface WindowCounts {
  readonly count: number;
  readonly events: number;
}

export interface CountWindow {
  readonly from: string;
  readonly to: string;
  readonly lane?: string;
}

export interface ReportingRepository {
  run(report: Report, tenantId: string, parameters: ReportParameters): Promise<ReportResult>;
  countWindow(tenantId: string, metric: Metric, window: CountWindow): Promise<WindowCounts>;
}

export interface Clock {
  now(): Date;
}

export interface ReportingDeps {
  readonly repository: ReportingRepository;
  readonly clock: Clock;
}
