import { z } from "zod";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";
import type { Route } from "../adapters/http.js";
import { planDay } from "../application/plan-day.js";
import type { PlanningDeps } from "../application/ports.js";

export const planBody = z.object({
  hub_id: z.string().min(1),
  hub_latitude: z.number(),
  hub_longitude: z.number(),
  date: z.iso.date(),
  vehicles: z
    .array(
      z.object({
        id: z.string().min(1),
        max_stops: z.number().int().positive(),
        max_weight_grams: z.number().int().positive(),
        shift_minutes: z.number().int().positive(),
      }),
    )
    .min(1),
  jobs: z
    .array(
      z.object({
        id: z.string().min(1),
        weight_grams: z.number().int().positive(),
        service_minutes: z.number().int().nonnegative().default(5),
        latitude: z.number(),
        longitude: z.number(),
      }),
    )
    .min(1),
});

export interface RouteDeps extends PlanningDeps {
  readonly lookup: CallerLookup;
}

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function planRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/plans",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:write");

      const parsed = planBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const plan = await planDay(deps, {
        tenantId: caller.tenantId,
        hubId: parsed.data.hub_id,
        hubLocation: {
          latitude: parsed.data.hub_latitude,
          longitude: parsed.data.hub_longitude,
        },
        date: parsed.data.date,
        vehicles: parsed.data.vehicles.map((v) => ({
          id: v.id,
          maxStops: v.max_stops,
          maxWeightGrams: v.max_weight_grams,
          shiftMinutes: v.shift_minutes,
        })),
        jobs: parsed.data.jobs.map((j) => ({
          id: j.id,
          weightGrams: j.weight_grams,
          serviceMinutes: j.service_minutes,
          location: { latitude: j.latitude, longitude: j.longitude },
        })),
      });

      return { status: 201, body: plan };
    },
  };
}

function readRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/plans/:hubId/:date",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:read");

      const runs = await deps.repository.planFor(
        caller.tenantId,
        request.params["hubId"] ?? "",
        request.params["date"] ?? "",
      );
      return { status: 200, body: runs };
    },
  };
}

export function planningRoutes(deps: RouteDeps): Route[] {
  return [planRoute(deps), readRoute(deps)];
}
