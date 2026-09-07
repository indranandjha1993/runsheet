import { z } from "zod";
import { DomainError } from "../domain/errors.js";
import type { Route } from "../adapters/http.js";
import { captureProof, planRun, recordRunEvent } from "../application/run-operations.js";
import type { ExecutionDeps } from "../application/ports.js";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";
import type { RunEvent } from "../domain/run.js";
import type { Scan } from "../domain/hub-floor.js";
import { recordScanIn, recordScanOut } from "../application/hub-operations.js";

const planBody = z.object({
  hub_id: z.string().min(1),
  date: z.iso.date(),
  stops: z
    .array(
      z.object({
        sequence: z.number().int().positive(),
        actions: z
          .array(
            z.object({
              kind: z.enum(["deliver", "pickup", "return"]),
              consignment_id: z.string().min(1),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

const actionBody = z.object({
  stop_id: z.string().min(1),
  action_id: z.string().min(1),
  result: z.enum(["done", "failed", "skipped"]),
  ndr_reason: z.string().optional(),
  proof_id: z.string().optional(),
  cash_collected_minor: z.number().int().optional(),
});

const eventBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assigned"),
    worker_id: z.string().min(1),
    vehicle_id: z.string().min(1),
  }),
  z.object({ type: z.literal("unassigned") }),
  z.object({ type: z.literal("started") }),
  z.object({ type: z.literal("suspended"), reason: z.string().min(1) }),
  z.object({
    type: z.literal("stop_moved"),
    stop_id: z.string().min(1),
    to_run_id: z.string().min(1),
  }),
  z.object({ type: z.literal("completed") }),
  z.object({ type: z.literal("cash_declared"), amount_minor: z.number().int() }),
  z.object({ type: z.literal("cash_counted"), amount_minor: z.number().int() }),
  z.object({ type: z.literal("closed") }),
  z.object({ type: z.literal("force_closed"), reason: z.string().min(1) }),
  z.object({ type: z.literal("cancelled") }),
]);

type EventBody = z.infer<typeof eventBody>;

const proofBody = z.object({
  consignment_id: z.string().min(1),
  requirement: z.string().min(1),
  kinds: z.array(z.enum(["photo", "signature", "otp", "geofence"])),
  media_ids: z.array(z.string()).default([]),
  geofence_ok: z.boolean().optional(),
});

type Builders = { [K in EventBody["type"]]: (body: Extract<EventBody, { type: K }>) => RunEvent };

const plain = (type: RunEvent["type"]) => (): RunEvent => ({ type }) as RunEvent;

const BUILDERS: Builders = {
  unassigned: plain("unassigned"),
  started: plain("started"),
  completed: plain("completed"),
  closed: plain("closed"),
  cancelled: plain("cancelled"),
  assigned: (b) => ({ type: "assigned", workerId: b.worker_id, vehicleId: b.vehicle_id }),
  suspended: (b) => ({ type: "suspended", reason: b.reason }),
  stop_moved: (b) => ({ type: "stop_moved", stopId: b.stop_id, toRunId: b.to_run_id }),
  cash_declared: (b) => ({ type: "cash_declared", amountMinor: b.amount_minor }),
  cash_counted: (b) => ({ type: "cash_counted", amountMinor: b.amount_minor }),
  force_closed: (b) => ({ type: "force_closed", reason: b.reason }),
};

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function planRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/runs",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:write");

      const parsed = planBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const run = await planRun(deps, {
        tenantId: caller.tenantId,
        hubId: parsed.data.hub_id,
        date: parsed.data.date,
        stops: parsed.data.stops.map((stop) => ({
          sequence: stop.sequence,
          actions: stop.actions.map((a) => ({ kind: a.kind, consignmentId: a.consignment_id })),
        })),
      });

      return { status: 201, body: { id: run.id, status: run.status, stops: run.stops } };
    },
  };
}

function eventRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/runs/:id/events",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:write");

      const parsed = eventBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const build = BUILDERS[parsed.data.type] as (b: EventBody) => RunEvent;
      const run = await recordRunEvent(deps, {
        tenantId: caller.tenantId,
        runId: request.params["id"] ?? "",
        event: build(parsed.data),
      });

      return { status: 200, body: { id: run.id, status: run.status } };
    },
  };
}

function actionRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/runs/:id/actions",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:write");

      const parsed = actionBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const run = await recordRunEvent(deps, {
        tenantId: caller.tenantId,
        runId: request.params["id"] ?? "",
        event: {
          type: "action_recorded",
          stopId: parsed.data.stop_id,
          action: {
            actionId: parsed.data.action_id,
            result: parsed.data.result,
            ...(parsed.data.ndr_reason === undefined ? {} : { ndrReason: parsed.data.ndr_reason }),
            ...(parsed.data.proof_id === undefined ? {} : { proofId: parsed.data.proof_id }),
            ...(parsed.data.cash_collected_minor === undefined
              ? {}
              : { cashCollectedMinor: parsed.data.cash_collected_minor }),
          },
        },
      });

      return { status: 200, body: { id: run.id, status: run.status } };
    },
  };
}

function proofRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/proofs",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:write");

      const parsed = proofBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const proof = await captureProof(deps, {
        tenantId: caller.tenantId,
        consignmentId: parsed.data.consignment_id,
        requirement: parsed.data.requirement,
        kinds: parsed.data.kinds,
        mediaIds: parsed.data.media_ids,
        ...(parsed.data.geofence_ok === undefined ? {} : { geofenceOk: parsed.data.geofence_ok }),
      });

      return { status: 201, body: proof };
    },
  };
}

function readRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/runs/:id",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:read");

      const found = await deps.repository.runById(caller.tenantId, request.params["id"] ?? "");
      if (found === undefined) throw new DomainError("not_found", "no run with that identifier");
      return { status: 200, body: found.run };
    },
  };
}

const scanInBody = z.object({
  hub_id: z.string().min(1),
  worker_id: z.string().min(1),
  consignment_id: z.string().min(1),
  barcode: z.string().min(1),
  expected: z.boolean().default(true),
  weight_grams: z.number().int().positive().optional(),
  booked_weight_grams: z.number().int().positive().optional(),
  dimensions_mm: z
    .object({
      length: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
});

const scanOutBody = z.object({
  hub_id: z.string().min(1),
  worker_id: z.string().min(1),
  consignment_id: z.string().min(1),
  barcode: z.string().min(1),
  run_id: z.string().min(1),
  on_run: z.boolean(),
});

function scanResponse(scan: Scan): Record<string, unknown> {
  return {
    consignment_id: scan.consignmentId,
    hub_id: scan.hubId,
    scanned_at: scan.at,
    accepted: scan.accepted,
    ...(scan.weightGrams === undefined ? {} : { weight_grams: scan.weightGrams }),
    ...(scan.volumetricGrams === undefined ? {} : { volumetric_grams: scan.volumetricGrams }),
    ...(scan.exception === undefined ? {} : { exception: scan.exception }),
  };
}

function scanInRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/hub-scans/in",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:write");

      const parsed = scanInBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const scan = await recordScanIn(deps, {
        tenantId: caller.tenantId,
        hubId: parsed.data.hub_id,
        workerId: parsed.data.worker_id,
        consignmentId: parsed.data.consignment_id,
        barcode: parsed.data.barcode,
        expected: parsed.data.expected,
        ...(parsed.data.weight_grams === undefined
          ? {}
          : { weightGrams: parsed.data.weight_grams }),
        ...(parsed.data.booked_weight_grams === undefined
          ? {}
          : { bookedWeightGrams: parsed.data.booked_weight_grams }),
        ...(parsed.data.dimensions_mm === undefined
          ? {}
          : { dimensionsMm: parsed.data.dimensions_mm }),
      });

      return { status: 201, body: scanResponse(scan) };
    },
  };
}

function scanOutRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/hub-scans/out",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:write");

      const parsed = scanOutBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const scan = await recordScanOut(deps, {
        tenantId: caller.tenantId,
        hubId: parsed.data.hub_id,
        workerId: parsed.data.worker_id,
        consignmentId: parsed.data.consignment_id,
        barcode: parsed.data.barcode,
        runId: parsed.data.run_id,
        onRun: parsed.data.on_run,
      });

      // The scan is kept either way; the refusal is what the loader on the floor needs to see.
      if (!scan.accepted) {
        return {
          status: 409,
          body: {
            error: {
              code: scan.exception ?? "not_on_this_run",
              message: "that parcel is not on this run",
            },
          },
        };
      }
      return { status: 201, body: scanResponse(scan) };
    },
  };
}

function scanHistoryRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/hub-scans",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:read");

      const consignmentId = request.query["consignment_id"] ?? "";
      if (consignmentId === "") return invalid("name the consignment whose scans you want");

      const scans = await deps.repository.scansFor(caller.tenantId, consignmentId);
      return { status: 200, body: { scans: scans.map(scanResponse) } };
    },
  };
}

export interface RouteDeps extends ExecutionDeps {
  readonly lookup: CallerLookup;
}

export function executionRoutes(deps: RouteDeps): Route[] {
  return [
    planRoute(deps),
    eventRoute(deps),
    actionRoute(deps),
    proofRoute(deps),
    readRoute(deps),
    scanInRoute(deps),
    scanOutRoute(deps),
    scanHistoryRoute(deps),
  ];
}
