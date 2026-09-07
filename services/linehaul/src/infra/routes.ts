import { z } from "zod";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";
import { DomainError } from "../domain/errors.js";
import type { Route } from "../adapters/http.js";
import { bagParcel, recordBagEvent, sealBag } from "../application/bag-operations.js";
import {
  loadBag,
  manifestOf,
  planTripFor,
  recordTripEvent,
} from "../application/trip-operations.js";
import type { LinehaulDeps } from "../application/ports.js";
import type { TripEvent } from "../domain/trip.js";

export const bagParcelBody = z.object({
  origin_hub_id: z.string().min(1),
  destination_hub_id: z.string().min(1),
  consignment_id: z.string().min(1),
});

export const sealBody = z.object({ seal_number: z.string().min(1) });

export const bagEventBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("parcel_removed"), consignment_id: z.string().min(1) }),
  z.object({ type: z.literal("received"), hub_id: z.string().min(1), seal_intact: z.boolean() }),
  z.object({ type: z.literal("emptied"), scanned_ids: z.array(z.string().min(1)) }),
]);

export const tripBody = z.object({
  origin_hub_id: z.string().min(1),
  destination_hub_id: z.string().min(1),
  departs_on: z.iso.date(),
  capacity_bags: z.number().int().positive(),
});

export const tripEventBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("crewed"),
    vehicle_id: z.string().min(1),
    driver_id: z.string().min(1),
  }),
  z.object({ type: z.literal("bag_unloaded"), bag_id: z.string().min(1) }),
  z.object({ type: z.literal("departed") }),
  z.object({ type: z.literal("arrived"), hub_id: z.string().min(1) }),
  z.object({ type: z.literal("closed"), received_bag_ids: z.array(z.string().min(1)) }),
  z.object({ type: z.literal("cancelled"), reason: z.string().min(1) }),
]);

type TripEventBody = z.infer<typeof tripEventBody>;

type TripBuilders = {
  [K in TripEventBody["type"]]: (body: Extract<TripEventBody, { type: K }>) => TripEvent;
};

const TRIP_EVENTS: TripBuilders = {
  crewed: (b) => ({ type: "crewed", vehicleId: b.vehicle_id, driverId: b.driver_id }),
  bag_unloaded: (b) => ({ type: "bag_unloaded", bagId: b.bag_id }),
  departed: () => ({ type: "departed" }),
  arrived: (b) => ({ type: "arrived", hubId: b.hub_id }),
  closed: (b) => ({ type: "closed", receivedBagIds: b.received_bag_ids }),
  cancelled: (b) => ({ type: "cancelled", reason: b.reason }),
};

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function bagView(bag: {
  id: string;
  status: string;
  consignmentIds: readonly string[];
  sealNumber?: string;
  missingIds: readonly string[];
  unexpectedIds: readonly string[];
  misrouted: boolean;
  sealBroken: boolean;
}): Record<string, unknown> {
  return {
    id: bag.id,
    status: bag.status,
    consignment_ids: bag.consignmentIds,
    seal_number: bag.sealNumber ?? null,
    missing_consignment_ids: bag.missingIds,
    unexpected_consignment_ids: bag.unexpectedIds,
    misrouted: bag.misrouted,
    seal_broken: bag.sealBroken,
  };
}

function bagParcelRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/bags/parcels",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "linehaul:write");

      const parsed = bagParcelBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const bag = await bagParcel(deps, {
        tenantId: caller.tenantId,
        originHubId: parsed.data.origin_hub_id,
        destinationHubId: parsed.data.destination_hub_id,
        consignmentId: parsed.data.consignment_id,
      });

      return { status: 201, body: bagView(bag) };
    },
  };
}

function sealRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/bags/:id/seal",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "linehaul:write");

      const parsed = sealBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const bag = await sealBag(deps, {
        tenantId: caller.tenantId,
        bagId: request.params["id"] ?? "",
        sealNumber: parsed.data.seal_number,
      });

      return { status: 200, body: bagView(bag) };
    },
  };
}

function bagEventRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/bags/:id/events",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "linehaul:write");

      const parsed = bagEventBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const body = parsed.data;
      const bag = await recordBagEvent(deps, {
        tenantId: caller.tenantId,
        bagId: request.params["id"] ?? "",
        event:
          body.type === "parcel_removed"
            ? { type: "parcel_removed", consignmentId: body.consignment_id }
            : body.type === "received"
              ? { type: "received", hubId: body.hub_id, sealIntact: body.seal_intact }
              : { type: "emptied", scannedIds: body.scanned_ids },
      });

      return { status: 200, body: bagView(bag) };
    },
  };
}

function bagReadRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/bags/:id",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "linehaul:read");

      const found = await deps.repository.bagById(caller.tenantId, request.params["id"] ?? "");
      if (found === undefined) throw new DomainError("not_found", "no bag with that identifier");
      return { status: 200, body: bagView(found.bag) };
    },
  };
}

function tripRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/trips",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "linehaul:write");

      const parsed = tripBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const trip = await planTripFor(deps, {
        tenantId: caller.tenantId,
        originHubId: parsed.data.origin_hub_id,
        destinationHubId: parsed.data.destination_hub_id,
        departsOn: parsed.data.departs_on,
        capacityBags: parsed.data.capacity_bags,
      });

      return { status: 201, body: { id: trip.id, status: trip.status } };
    },
  };
}

function tripEventRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/trips/:id/events",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "linehaul:write");

      const parsed = tripEventBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const build = TRIP_EVENTS[parsed.data.type] as (b: TripEventBody) => TripEvent;
      const trip = await recordTripEvent(deps, {
        tenantId: caller.tenantId,
        tripId: request.params["id"] ?? "",
        event: build(parsed.data),
      });

      return {
        status: 200,
        body: {
          id: trip.id,
          status: trip.status,
          bag_ids: trip.bagIds,
          missing_bag_ids: trip.missingBagIds,
        },
      };
    },
  };
}

function loadRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/trips/:id/bags",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "linehaul:write");

      const parsed = z.object({ bag_id: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const { trip, bag } = await loadBag(deps, {
        tenantId: caller.tenantId,
        tripId: request.params["id"] ?? "",
        bagId: parsed.data.bag_id,
      });

      return { status: 201, body: { trip_id: trip.id, bag_ids: trip.bagIds, bag: bagView(bag) } };
    },
  };
}

function manifestRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/trips/:id/manifest",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "linehaul:read");

      const manifest = await manifestOf(deps, caller.tenantId, request.params["id"] ?? "");
      return { status: 200, body: manifest };
    },
  };
}

export interface RouteDeps extends LinehaulDeps {
  readonly lookup: CallerLookup;
}

export function linehaulRoutes(deps: RouteDeps): Route[] {
  return [
    bagParcelRoute(deps),
    sealRoute(deps),
    bagEventRoute(deps),
    bagReadRoute(deps),
    tripRoute(deps),
    tripEventRoute(deps),
    loadRoute(deps),
    manifestRoute(deps),
  ];
}
