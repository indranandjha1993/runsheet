import { z } from "zod";
import { DomainError } from "../domain/errors.js";
import type { Route } from "../adapters/http.js";
import { captureProof, planRun, recordRunEvent } from "../application/run-operations.js";
import type { ExecutionDeps } from "../application/ports.js";
import type { RunEvent } from "../domain/run.js";

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
  z.object({ type: z.literal("assigned"), worker_id: z.string().min(1), vehicle_id: z.string().min(1) }),
  z.object({ type: z.literal("unassigned") }),
  z.object({ type: z.literal("started") }),
  z.object({ type: z.literal("suspended"), reason: z.string().min(1) }),
  z.object({ type: z.literal("stop_moved"), stop_id: z.string().min(1), to_run_id: z.string().min(1) }),
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

const plain =
  (type: RunEvent["type"]) =>
  (): RunEvent => ({ type }) as RunEvent;

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

function tenantOf(headers: Record<string, string | undefined>): string {
  const tenant = headers["x-tenant-id"];
  if (tenant === undefined || tenant === "") {
    throw new DomainError("tenant_required", "the x-tenant-id header is required");
  }
  return tenant;
}

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function planRoute(deps: ExecutionDeps): Route {
  return {
    method: "POST",
    path: "/v1/runs",
    handle: async (request) => {
      const parsed = planBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const run = await planRun(deps, {
        tenantId: tenantOf(request.headers),
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

function eventRoute(deps: ExecutionDeps): Route {
  return {
    method: "POST",
    path: "/v1/runs/:id/events",
    handle: async (request) => {
      const parsed = eventBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const build = BUILDERS[parsed.data.type] as (b: EventBody) => RunEvent;
      const run = await recordRunEvent(deps, {
        tenantId: tenantOf(request.headers),
        runId: request.params["id"] ?? "",
        event: build(parsed.data),
      });

      return { status: 200, body: { id: run.id, status: run.status } };
    },
  };
}

function actionRoute(deps: ExecutionDeps): Route {
  return {
    method: "POST",
    path: "/v1/runs/:id/actions",
    handle: async (request) => {
      const parsed = actionBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const run = await recordRunEvent(deps, {
        tenantId: tenantOf(request.headers),
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

function proofRoute(deps: ExecutionDeps): Route {
  return {
    method: "POST",
    path: "/v1/proofs",
    handle: async (request) => {
      const parsed = proofBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const proof = await captureProof(deps, {
        tenantId: tenantOf(request.headers),
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

function readRoute(deps: ExecutionDeps): Route {
  return {
    method: "GET",
    path: "/v1/runs/:id",
    handle: async (request) => {
      const found = await deps.repository.runById(
        tenantOf(request.headers),
        request.params["id"] ?? "",
      );
      if (found === undefined) throw new DomainError("not_found", "no run with that identifier");
      return { status: 200, body: found.run };
    },
  };
}

export function executionRoutes(deps: ExecutionDeps): Route[] {
  return [planRoute(deps), eventRoute(deps), actionRoute(deps), proofRoute(deps), readRoute(deps)];
}
