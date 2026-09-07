import { z } from "zod";
import type { Route } from "../adapters/http.js";
import { checkServiceability } from "../application/check-serviceability.js";
import { registerHub, type RegisterHubDeps } from "../application/register-hub.js";

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

function tenantOf(headers: Record<string, string | undefined>): string {
  const tenant = headers["x-tenant-id"];
  if (tenant === undefined || tenant === "") {
    throw new Error("x-tenant-id header is required");
  }
  return tenant;
}

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function createHubRoute(deps: RegisterHubDeps): Route {
  return {
    method: "POST",
    path: "/v1/hubs",
    handle: async (request) => {
      const parsed = hubBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "invalid body");

      const hub = await registerHub(deps, {
        tenantId: tenantOf(request.headers),
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

function serviceabilityRoute(deps: RegisterHubDeps): Route {
  return {
    method: "GET",
    path: "/v1/serviceability",
    handle: async (request) => {
      const query = Object.fromEntries(new URL(request.url, "http://local").searchParams);
      const parsed = serviceabilityQuery.safeParse(query);
      if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "invalid query");

      const answer = await checkServiceability(deps, {
        tenantId: tenantOf(request.headers),
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        service: parsed.data.service,
        at: deps.clock.now(),
      });

      return { status: 200, body: answer };
    },
  };
}

export function networkRoutes(deps: RegisterHubDeps): Route[] {
  return [createHubRoute(deps), serviceabilityRoute(deps)];
}
