import { types, type Pool } from "pg";
import { compile, headerOf, type Report, type ReportParameters } from "../domain/reports.js";
import type { Cell } from "../domain/csv.js";
import type { ReportingRepository } from "../application/ports.js";

// A calendar day is a day, not a moment. Left to the driver it shifts backwards east of UTC.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value: string) => value);

// Numeric comes back as a string so a big value cannot silently lose precision. Reports show
// counts and hours, which fit, so they are read as numbers here and nowhere else.
const NUMERIC_OID = 1700;
types.setTypeParser(NUMERIC_OID, (value: string) => Number(value));

const BIGINT_OID = 20;
types.setTypeParser(BIGINT_OID, (value: string) => Number(value));

export function postgresReporting(pool: Pool): ReportingRepository {
  return {
    async run(report: Report, tenantId: string, parameters: ReportParameters) {
      const query = compile(report, tenantId, parameters);
      const result = await pool.query<Record<string, Cell>>(query.text, [...query.values]);
      return { columns: headerOf(report), rows: result.rows };
    },
  };
}
