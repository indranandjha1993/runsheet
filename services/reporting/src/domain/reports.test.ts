import { describe, expect, it } from "vitest";
import { compile, REPORTS, reportNamed, type Report } from "./reports.js";

describe("the reports an operator can run", () => {
  it("offers the ones a depot manager asks for every morning", () => {
    expect(REPORTS.map((report) => report.name)).toEqual([
      "delivery_performance",
      "failed_deliveries",
      "cash_position",
      "hub_throughput",
      "exception_ageing",
      "linehaul_utilisation",
    ]);
  });

  it("says what each one is for, so nobody has to read the query", () => {
    for (const report of REPORTS) {
      expect(report.description.length).toBeGreaterThan(20);
      expect(report.columns.length).toBeGreaterThan(1);
      expect(new Set(report.columns.map((column) => column.name)).size).toBe(report.columns.length);
    }
  });

  it("finds one by name", () => {
    expect(reportNamed("cash_position")?.name).toBe("cash_position");
  });

  it("finds nothing for a name nobody defined", () => {
    expect(reportNamed("salaries")).toBeUndefined();
  });
});

function named(name: string): Report {
  const report = reportNamed(name);
  if (report === undefined) throw new Error(`no report called ${name}`);
  return report;
}

describe("compiling a report to run", () => {
  const report = named("delivery_performance");

  it("always scopes to the caller's own tenant, first parameter, every time", () => {
    const query = compile(report, "tenant-1", { from: "2026-09-01", to: "2026-09-07" });

    expect(query.values[0]).toBe("tenant-1");
    expect(query.text).toContain("tenant_id = $1");
  });

  it("passes the dates as parameters rather than pasting them into the query", () => {
    const query = compile(report, "tenant-1", { from: "2026-09-01", to: "2026-09-07" });

    expect(query.values).toEqual(["tenant-1", "2026-09-01", "2026-09-07"]);
    expect(query.text).not.toContain("2026-09-01");
  });

  it("refuses a date that is not a date, rather than passing it along", () => {
    expect(() => compile(report, "t", { from: "yesterday", to: "2026-09-07" })).toThrow(
      "from must be a date",
    );
  });

  it("refuses a range that runs backwards", () => {
    expect(() => compile(report, "t", { from: "2026-09-07", to: "2026-09-01" })).toThrow(
      "the range ends before it starts",
    );
  });

  it("refuses a range longer than a quarter, which nobody exports by accident", () => {
    expect(() => compile(report, "t", { from: "2026-01-01", to: "2026-09-07" })).toThrow(
      "that range is too long to export in one go",
    );
  });

  it("takes an optional hub and adds it as another parameter", () => {
    const query = compile(report, "t", { from: "2026-09-01", to: "2026-09-07", hub: "BLR1" });

    expect(query.values).toContain("BLR1");
  });

  it("refuses a hub with anything but a code in it", () => {
    expect(() =>
      compile(report, "t", {
        from: "2026-09-01",
        to: "2026-09-07",
        hub: "'; DROP TABLE runs; --",
      }),
    ).toThrow("hub must be a hub code");
  });

  it("only ever reads", () => {
    for (const one of REPORTS) {
      const query = compile(one, "t", { from: "2026-09-01", to: "2026-09-07" });

      expect(query.text.trimStart().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(query.text.toUpperCase()).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|COPY)\b/);
    }
  });

  it("caps how much comes back, so one export cannot take the database down", () => {
    for (const one of REPORTS) {
      const query = compile(one, "t", { from: "2026-09-01", to: "2026-09-07" });

      expect(query.text).toContain("LIMIT");
    }
  });
});
