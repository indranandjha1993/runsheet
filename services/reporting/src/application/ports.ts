import type { Cell } from "../domain/csv.js";
import type { Report, ReportParameters } from "../domain/reports.js";

export interface ReportResult {
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, Cell>[];
}

export interface ReportingRepository {
  run(report: Report, tenantId: string, parameters: ReportParameters): Promise<ReportResult>;
}

export interface Clock {
  now(): Date;
}

export interface ReportingDeps {
  readonly repository: ReportingRepository;
  readonly clock: Clock;
}
