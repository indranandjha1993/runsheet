import { z } from "zod";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";
import { DomainError } from "../domain/errors.js";
import type { Route } from "../adapters/http.js";
import { toCsv } from "../domain/csv.js";
import { assertParameters, REPORTS, reportNamed } from "../domain/reports.js";
import type { ReportingDeps, ReportResult } from "../application/ports.js";
import { compareWindows, METRICS } from "../application/baseline-report.js";

export const runReportQuery = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  hub: z.string().min(1).optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function catalogueRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/reports",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "reports:read");

      return {
        status: 200,
        body: {
          reports: REPORTS.map((report) => ({
            name: report.name,
            description: report.description,
            columns: report.columns.map((column) => column.name),
            accepts_hub: report.hubColumn !== undefined,
          })),
        },
      };
    },
  };
}

function fileNameFor(name: string, from: string, to: string): string {
  return `${name}-${from}-to-${to}.csv`;
}

function asFile(
  result: ReportResult,
  name: string,
  from: string,
  to: string,
): { status: number; body: unknown; headers: Record<string, string> } {
  return {
    status: 200,
    body: toCsv(result.columns, result.rows),
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileNameFor(name, from, to)}"`,
    },
  };
}

interface Ran {
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly generatedAt: Date;
}

function asData(result: ReportResult, ran: Ran): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      report: ran.name,
      from: ran.from,
      to: ran.to,
      columns: result.columns,
      rows: result.rows,
      generated_at: ran.generatedAt,
    },
  };
}

function runRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/reports/:name",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "reports:read");

      const report = reportNamed(request.params["name"] ?? "");
      if (report === undefined) {
        throw new DomainError("not_found", "no report by that name");
      }

      const parsed = runReportQuery.safeParse(request.query);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const { from, to, hub, format } = parsed.data;
      const parameters = { from, to, ...(hub === undefined ? {} : { hub }) };
      assertParameters(report, parameters);

      const result = await deps.repository.run(report, caller.tenantId, parameters);

      return format === "csv"
        ? asFile(result, report.name, from, to)
        : asData(result, { name: report.name, from, to, generatedAt: deps.clock.now() });
    },
  };
}

export const baselineQuery = z.object({
  metric: z.string().min(1),
  baseline_from: z.iso.date(),
  baseline_to: z.iso.date(),
  measured_from: z.iso.date(),
  measured_to: z.iso.date(),
  lane: z.string().min(1).optional(),
});

function metricsRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/baselines/metrics",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "reports:read");

      return {
        status: 200,
        body: {
          metrics: METRICS.map((metric) => ({
            name: metric.name,
            description: metric.description,
            better_when: metric.betterWhen,
          })),
        },
      };
    },
  };
}

function baselineRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/baselines/comparison",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "reports:read");

      const parsed = baselineQuery.safeParse(request.query);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const query = parsed.data;
      const comparison = await compareWindows(deps, {
        tenantId: caller.tenantId,
        metric: query.metric,
        baseline: { from: query.baseline_from, to: query.baseline_to },
        measured: { from: query.measured_from, to: query.measured_to },
        ...(query.lane === undefined ? {} : { lane: query.lane }),
      });

      return { status: 200, body: comparison };
    },
  };
}

export interface RouteDeps extends ReportingDeps {
  readonly lookup: CallerLookup;
}

export function reportingRoutes(deps: RouteDeps): Route[] {
  return [catalogueRoute(deps), runRoute(deps), metricsRoute(deps), baselineRoute(deps)];
}
