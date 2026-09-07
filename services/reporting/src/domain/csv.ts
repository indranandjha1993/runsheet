// Exported files land in a spreadsheet, and a spreadsheet runs a cell that starts with one of
// these as a formula. An operator's report must never execute anything.
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\n\r]/;

export type Cell = string | number | boolean | Date | null | undefined;

function textOf(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function escape(value: Cell): string {
  const text = textOf(value);
  const defused = FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused;
}

export function toCsv(columns: readonly string[], rows: readonly Record<string, Cell>[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => escape(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}
