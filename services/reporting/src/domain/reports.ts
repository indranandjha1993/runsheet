import { DomainError } from "./errors.js";

// Reports are named and fixed. A caller chooses one and supplies parameters; nobody sends SQL,
// so there is nothing to inject into and no way to read another tenant's rows.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HUB_CODE = /^[A-Z0-9]{2,12}$/;
const MAX_RANGE_DAYS = 92;
const MAX_ROWS = 50_000;

export interface Column {
  readonly name: string;
  readonly expression: string;
}

export interface Report {
  readonly name: string;
  readonly description: string;
  readonly columns: readonly Column[];
  readonly from: string;
  readonly dateColumn: string;
  readonly where?: string;
  readonly groupBy: string;
  readonly orderBy: string;
  readonly hubColumn?: string;
}

const day = (column: string): Column => ({ name: "day", expression: column });
const total = (name: string, column = name): Column => ({
  name,
  expression: `SUM(${column})`,
});

export const REPORTS: readonly Report[] = [
  {
    name: "delivery_performance",
    description: "How many consignments were delivered, attempted, and returned, by day and hub.",
    columns: [
      day("occurred_on"),
      { name: "hub_id", expression: "hub_id" },
      total("delivered"),
      total("attempted"),
      total("returned"),
    ],
    from: "consignment_outcomes",
    dateColumn: "occurred_on",
    groupBy: "occurred_on, hub_id",
    orderBy: "occurred_on DESC, hub_id",
    hubColumn: "hub_id",
  },
  {
    name: "failed_deliveries",
    description: "Every failed attempt with its reason, so the reasons can be counted and worked.",
    columns: [
      day("occurred_on"),
      { name: "hub_id", expression: "hub_id" },
      { name: "reason", expression: "reason" },
      total("attempts", "attempted"),
    ],
    from: "consignment_outcomes",
    dateColumn: "occurred_on",
    where: "reason <> ''",
    groupBy: "occurred_on, hub_id, reason",
    orderBy: "SUM(attempted) DESC",
    hubColumn: "hub_id",
  },
  {
    name: "cash_position",
    description: "What each driver is holding and what has been banked, by day.",
    columns: [
      day("occurred_on"),
      { name: "driver_id", expression: "driver_id" },
      { name: "currency", expression: "currency" },
      total("collected_minor"),
      total("deposited_minor"),
    ],
    from: "cash_positions",
    dateColumn: "occurred_on",
    groupBy: "occurred_on, driver_id, currency",
    orderBy: "occurred_on DESC, driver_id",
  },
  {
    name: "hub_throughput",
    description: "Parcels scanned in and out of each hub, with the exceptions they raised.",
    columns: [
      day("occurred_on"),
      { name: "hub_id", expression: "hub_id" },
      total("scanned_in"),
      total("scanned_out"),
      total("exceptions"),
    ],
    from: "hub_activity",
    dateColumn: "occurred_on",
    groupBy: "occurred_on, hub_id",
    orderBy: "occurred_on DESC, hub_id",
    hubColumn: "hub_id",
  },
  {
    name: "exception_ageing",
    description: "Open exceptions by type and how long each has been waiting for somebody.",
    columns: [
      { name: "type", expression: "type" },
      { name: "severity", expression: "severity" },
      { name: "open_count", expression: "COUNT(*)" },
      { name: "oldest_hours", expression: "MAX(open_hours)" },
    ],
    from: "exception_ageing",
    dateColumn: "opened_on",
    groupBy: "type, severity",
    orderBy: "MAX(open_hours) DESC",
  },
  {
    name: "linehaul_utilisation",
    description: "How full each linehaul trip left, and what did not come off at the far end.",
    columns: [
      day("departed_on"),
      { name: "lane", expression: "lane" },
      { name: "trips", expression: "COUNT(*)" },
      total("bags"),
      total("capacity_bags"),
      total("missing_bags"),
    ],
    from: "linehaul_trips",
    dateColumn: "departed_on",
    groupBy: "departed_on, lane",
    orderBy: "departed_on DESC, lane",
  },
];

export function reportNamed(name: string): Report | undefined {
  return REPORTS.find((report) => report.name === name);
}

export function headerOf(report: Report): string[] {
  return report.columns.map((column) => column.name);
}

export interface ReportParameters {
  readonly from: string;
  readonly to: string;
  readonly hub?: string;
}

export interface CompiledQuery {
  readonly text: string;
  readonly values: readonly string[];
}

// Validation is separate from building the query, because the edge has to refuse bad input
// before anything reaches the database, and the query builder must not be the only place that
// checks.
export function assertParameters(report: Report, parameters: ReportParameters): void {
  assertRange(parameters);
  if (parameters.hub === undefined) return;

  if (report.hubColumn === undefined) {
    throw new DomainError("invalid_input", "this report is not broken down by hub");
  }
  if (!HUB_CODE.test(parameters.hub)) {
    throw new DomainError("invalid_input", "hub must be a hub code");
  }
}

function assertRange(parameters: ReportParameters): void {
  if (!DATE.test(parameters.from)) throw new DomainError("invalid_input", "from must be a date");
  if (!DATE.test(parameters.to)) throw new DomainError("invalid_input", "to must be a date");

  const span = (Date.parse(parameters.to) - Date.parse(parameters.from)) / 86_400_000;
  if (span < 0) throw new DomainError("invalid_input", "the range ends before it starts");
  if (span > MAX_RANGE_DAYS) {
    throw new DomainError("invalid_input", "that range is too long to export in one go");
  }
}

export function compile(
  report: Report,
  tenantId: string,
  parameters: ReportParameters,
): CompiledQuery {
  assertParameters(report, parameters);

  const values: string[] = [tenantId, parameters.from, parameters.to];
  const clauses = [`tenant_id = $1`, `${report.dateColumn} BETWEEN $2 AND $3`];
  if (report.where !== undefined) clauses.push(report.where);

  if (parameters.hub !== undefined && report.hubColumn !== undefined) {
    values.push(parameters.hub);
    clauses.push(`${report.hubColumn} = $${String(values.length)}`);
  }

  const select = report.columns
    .map((column) => `${column.expression} AS ${column.name}`)
    .join(", ");

  const text = `SELECT ${select}
     FROM ${report.from}
     WHERE ${clauses.join(" AND ")}
     GROUP BY ${report.groupBy}
     ORDER BY ${report.orderBy}
     LIMIT ${String(MAX_ROWS)}`;

  return { text, values };
}
