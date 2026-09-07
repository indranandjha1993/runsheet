import { types, type Pool } from "pg";
import { compile, headerOf, type Report, type ReportParameters } from "../domain/reports.js";
import type { Cell } from "../domain/csv.js";
import type { CountWindow, ReportingRepository, WindowCounts } from "../application/ports.js";
import type { Metric } from "../application/baseline-report.js";

// A calendar day is a day, not a moment. Left to the driver it shifts backwards east of UTC.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value: string) => value);

// Numeric comes back as a string so a big value cannot silently lose precision. Reports show
// counts and hours, which fit, so they are read as numbers here and nowhere else.
const NUMERIC_OID = 1700;
types.setTypeParser(NUMERIC_OID, (value: string) => Number(value));

const BIGINT_OID = 20;
types.setTypeParser(BIGINT_OID, (value: string) => Number(value));

// Every metric is a rate over the same projection, so one query serves all of them. The columns
// come from the metric definition and never from a caller.
const SOURCE: Record<string, string> = {
  failed_attempt_rate: "consignment_outcomes",
  return_rate: "consignment_outcomes",
  hub_exception_rate: "hub_activity",
};

const DATE_COLUMN: Record<string, string> = {
  failed_attempt_rate: "occurred_on",
  return_rate: "occurred_on",
  hub_exception_rate: "occurred_on",
};

async function countWindowIn(
  pool: Pool,
  tenantId: string,
  metric: Metric,
  window: CountWindow,
): Promise<WindowCounts> {
  const from = SOURCE[metric.name];
  const dateColumn = DATE_COLUMN[metric.name];
  if (from === undefined || dateColumn === undefined) {
    throw new Error(`no projection behind ${metric.name}`);
  }

  const values: string[] = [tenantId, window.from, window.to];
  let where = `tenant_id = $1 AND ${dateColumn} BETWEEN $2 AND $3`;
  if (window.lane !== undefined) {
    values.push(window.lane);
    where = `${where} AND hub_id = $4`;
  }

  const result = await pool.query<{ count: string | null; events: string | null }>(
    `SELECT COALESCE(SUM(${metric.countColumn}), 0) AS count,
            COALESCE(SUM(${metric.eventColumn}), 0) AS events
     FROM ${from} WHERE ${where}`,
    values,
  );
  const row = result.rows[0];
  return { count: Number(row?.count ?? 0), events: Number(row?.events ?? 0) };
}

export function postgresReporting(pool: Pool): ReportingRepository {
  return {
    countWindow: (tenantId, metric, window) => countWindowIn(pool, tenantId, metric, window),

    async run(report: Report, tenantId: string, parameters: ReportParameters) {
      const query = compile(report, tenantId, parameters);
      const result = await pool.query<Record<string, Cell>>(query.text, [...query.values]);
      return { columns: headerOf(report), rows: result.rows };
    },
  };
}
