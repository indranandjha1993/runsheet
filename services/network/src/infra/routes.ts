import { z } from "zod";
import type { Route } from "../adapters/http.js";
import { checkServiceability } from "../application/check-serviceability.js";
import { registerHub, type RegisterHubDeps } from "../application/register-hub.js";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";

const hubBody = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  country_code: z.string().length(2),
  time_zone: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  opens_minutes_of_day: z.number().int(),
  closes_minutes_of_day: z.number().int(),
});

const serviceabilityQuery = z.object({
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  service: z.string().min(1),
});

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function createHubRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/hubs",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "network:write");

      const parsed = hubBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((issue) => issue.message).join("; "));

      const hub = await registerHub(deps, {
        tenantId: caller.tenantId,
        code: parsed.data.code,
        name: parsed.data.name,
        countryCode: parsed.data.country_code,
        timeZone: parsed.data.time_zone,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        opensMinutesOfDay: parsed.data.opens_minutes_of_day,
        closesMinutesOfDay: parsed.data.closes_minutes_of_day,
      });

      return { status: 201, body: { id: hub.id, code: hub.code } };
    },
  };
}

function serviceabilityRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/serviceability",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "network:read");

      const query = Object.fromEntries(new URL(request.url, "http://local").searchParams);
      const parsed = serviceabilityQuery.safeParse(query);
      if (!parsed.success) return invalid(parsed.error.issues.map((issue) => issue.message).join("; "));

      const answer = await checkServiceability(deps, {
        tenantId: caller.tenantId,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        service: parsed.data.service,
        at: deps.clock.now(),
      });

      return { status: 200, body: answer };
    },
  };
}

export interface RouteDeps extends RegisterHubDeps {
  readonly lookup: CallerLookup;
}

export function networkRoutes(deps: RouteDeps): Route[] {
  return [createHubRoute(deps), serviceabilityRoute(deps)];
}
