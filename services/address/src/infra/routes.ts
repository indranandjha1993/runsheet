import { z } from "zod";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";
import { DomainError } from "../domain/errors.js";
import type { Route } from "../adapters/http.js";
import { confirm, resolve } from "../application/resolve.js";
import type { AddressDeps } from "../application/ports.js";

export const resolveBody = z.object({
  raw: z.string().min(1),
  country_code: z.string().length(2),
});

export const confirmBody = z.object({
  latitude: z.number(),
  longitude: z.number(),
  worker_id: z.string().min(1),
});

export interface RouteDeps extends AddressDeps {
  readonly lookup: CallerLookup;
}

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function resolveRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/addresses",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "addresses:write");

      const parsed = resolveBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const address = await resolve(deps, {
        tenantId: caller.tenantId,
        raw: parsed.data.raw,
        countryCode: parsed.data.country_code,
      });

      return { status: 201, body: address };
    },
  };
}

function confirmRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/addresses/:id/confirm",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "addresses:write");

      const parsed = confirmBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const address = await confirm(deps, {
        tenantId: caller.tenantId,
        addressId: request.params["id"] ?? "",
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        workerId: parsed.data.worker_id,
      });

      return { status: 200, body: address };
    },
  };
}

function readRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/addresses/:id",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "addresses:read");

      const address = await deps.repository.byId(caller.tenantId, request.params["id"] ?? "");
      if (address === undefined) {
        throw new DomainError("not_found", "no address with that identifier");
      }
      return { status: 200, body: address };
    },
  };
}

export function addressRoutes(deps: RouteDeps): Route[] {
  return [resolveRoute(deps), confirmRoute(deps), readRoute(deps)];
}
