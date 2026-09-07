import { z } from "zod";
import { DomainError } from "../domain/errors.js";
import type { Route } from "../adapters/http.js";
import { bookConsignment } from "../application/book-consignment.js";
import { recordConsignmentEvent } from "../application/record-event.js";
import type { OrdersDeps } from "../application/ports.js";
import { printLabels } from "../application/print-labels.js";
import { toZpl } from "../adapters/zpl.js";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";

export const bookBody = z
  .object({
    order_reference: z.string().min(1),
    origin_hub_code: z.string().min(1),
    destination_hub_code: z.string().min(1),
    service: z.string().min(1),
    payment_mode: z.enum(["prepaid", "cod"]),
    proof_requirement: z.string().min(1).default("photo"),
    attempt_limit: z.number().int().positive().default(3),
    cod_amount_minor: z.number().int().nonnegative().optional(),
    cod_currency: z.string().length(3).optional(),
    cod_tolerance_minor: z.number().int().nonnegative().optional(),
    packages: z.array(z.object({ weight_grams: z.number().int().positive() })).min(1),
  })
  .refine((b) => b.payment_mode !== "cod" || b.cod_amount_minor !== undefined, {
    message: "cod_amount_minor is required when payment is on delivery",
  });

export const eventBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("picked_up") }),
  z.object({
    type: z.literal("pickup_attempted"),
    ndr_reason: z.string().min(1),
    proof_id: z.string(),
  }),
  z.object({ type: z.literal("inscanned"), hub_id: z.string().min(1) }),
  z.object({ type: z.literal("departed_hub") }),
  z.object({ type: z.literal("out_for_delivery"), run_id: z.string().min(1) }),
  z.object({ type: z.literal("attempted"), ndr_reason: z.string().min(1), proof_id: z.string() }),
  z.object({
    type: z.literal("delivered"),
    proof_id: z.string(),
    cash_collected_minor: z.number().int().optional(),
  }),
  z.object({ type: z.literal("rto_initiated") }),
  z.object({ type: z.literal("rto_out_for_delivery"), run_id: z.string().min(1) }),
  z.object({ type: z.literal("rto_delivered"), proof_id: z.string() }),
  z.object({ type: z.literal("cancelled") }),
  z.object({ type: z.literal("cancel_requested") }),
  z.object({ type: z.literal("lost") }),
  z.object({ type: z.literal("found"), hub_id: z.string().min(1) }),
  z.object({ type: z.literal("damaged"), note: z.string() }),
]);

type EventBody = z.infer<typeof eventBody>;

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

type DomainEvent = Parameters<typeof recordConsignmentEvent>[1]["event"];

type Builders = {
  [K in EventBody["type"]]: (body: Extract<EventBody, { type: K }>) => DomainEvent;
};

const plain = (type: DomainEvent["type"]) => (): DomainEvent => ({ type }) as DomainEvent;

const BUILDERS: Builders = {
  picked_up: plain("picked_up"),
  departed_hub: plain("departed_hub"),
  rto_initiated: plain("rto_initiated"),
  cancelled: plain("cancelled"),
  cancel_requested: plain("cancel_requested"),
  lost: plain("lost"),
  pickup_attempted: (b) => ({
    type: "pickup_attempted",
    ndrReason: b.ndr_reason,
    proofId: b.proof_id,
  }),
  attempted: (b) => ({ type: "attempted", ndrReason: b.ndr_reason, proofId: b.proof_id }),
  inscanned: (b) => ({ type: "inscanned", hubId: b.hub_id }),
  found: (b) => ({ type: "found", hubId: b.hub_id }),
  out_for_delivery: (b) => ({ type: "out_for_delivery", runId: b.run_id }),
  rto_out_for_delivery: (b) => ({ type: "rto_out_for_delivery", runId: b.run_id }),
  rto_delivered: (b) => ({ type: "rto_delivered", proofId: b.proof_id }),
  damaged: (b) => ({ type: "damaged", note: b.note }),
  delivered: (b) => ({
    type: "delivered",
    proofId: b.proof_id,
    ...(b.cash_collected_minor === undefined ? {} : { cashCollectedMinor: b.cash_collected_minor }),
  }),
};

function toDomainEvent(body: EventBody): DomainEvent {
  const build = BUILDERS[body.type] as (b: EventBody) => DomainEvent;
  return build(body);
}

function bookRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/consignments",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "consignments:write");

      const parsed = bookBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const consignment = await bookConsignment(deps, {
        tenantId: caller.tenantId,
        orderReference: parsed.data.order_reference,
        originHubCode: parsed.data.origin_hub_code,
        destinationHubCode: parsed.data.destination_hub_code,
        service: parsed.data.service,
        paymentMode: parsed.data.payment_mode,
        proofRequirement: parsed.data.proof_requirement,
        attemptLimit: parsed.data.attempt_limit,
        ...(parsed.data.cod_amount_minor === undefined
          ? {}
          : { codAmountMinor: parsed.data.cod_amount_minor }),
        ...(parsed.data.cod_currency === undefined
          ? {}
          : { codCurrency: parsed.data.cod_currency }),
        ...(parsed.data.cod_tolerance_minor === undefined
          ? {}
          : { codToleranceMinor: parsed.data.cod_tolerance_minor }),
        packages: parsed.data.packages.map((p) => ({ weightGrams: p.weight_grams })),
      });

      return { status: 201, body: { id: consignment.id, status: consignment.status } };
    },
  };
}

function eventRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/consignments/:id/events",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "consignments:write");

      const parsed = eventBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const consignment = await recordConsignmentEvent(deps, {
        tenantId: caller.tenantId,
        consignmentId: request.params["id"] ?? "",
        event: toDomainEvent(parsed.data),
      });

      return { status: 200, body: { id: consignment.id, status: consignment.status } };
    },
  };
}

function readRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/consignments/:id",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "consignments:read");

      const found = await deps.repository.consignmentById(
        caller.tenantId,
        request.params["id"] ?? "",
      );
      if (found === undefined) {
        throw new DomainError("not_found", "no consignment with that identifier");
      }
      return { status: 200, body: found.consignment };
    },
  };
}

export interface RouteDeps extends OrdersDeps {
  readonly lookup: CallerLookup;
}

export const labelBody = z.object({
  origin: z.object({ hub_code: z.string().min(1), city: z.string().min(1) }),
  destination: z.object({
    hub_code: z.string().min(1),
    name: z.string().min(1),
    line: z.string().min(1),
    locality: z.string().min(1).optional(),
    city: z.string().min(1),
    postcode: z.string().min(1),
  }),
  sort_code: z.string().min(1),
  service_level: z.enum(["same_day", "next_day", "standard", "economy"]),
  format: z.enum(["json", "zpl"]).default("json"),
});

function listRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/consignments",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "consignments:read");

      const limit = Math.min(Number(request.query["limit"] ?? 100) || 100, 500);
      const consignments = await deps.repository.openConsignments(caller.tenantId, limit);
      return { status: 200, body: { consignments } };
    },
  };
}

function labelRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/consignments/:id/labels",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "consignments:write");

      const parsed = labelBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const { destination, origin } = parsed.data;
      const labels = await printLabels(deps, {
        tenantId: caller.tenantId,
        consignmentId: request.params["id"] ?? "",
        origin: { hubCode: origin.hub_code, city: origin.city },
        destination: {
          hubCode: destination.hub_code,
          name: destination.name,
          line: destination.line,
          city: destination.city,
          postcode: destination.postcode,
          ...(destination.locality === undefined ? {} : { locality: destination.locality }),
        },
        sortCode: parsed.data.sort_code,
        serviceLevel: parsed.data.service_level,
      });

      if (parsed.data.format === "zpl") {
        return {
          status: 200,
          body: labels.map(toZpl).join(""),
          headers: { "content-type": "application/vnd.zebra.zpl" },
        };
      }
      return { status: 200, body: { labels } };
    },
  };
}

export function ordersRoutes(deps: RouteDeps): Route[] {
  return [bookRoute(deps), eventRoute(deps), readRoute(deps), labelRoute(deps), listRoute(deps)];
}
