import { z } from "zod";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";
import { DomainError } from "../domain/errors.js";
import type { Route } from "../adapters/http.js";
import { promiseDelivery, reportEta, settle, viewByToken } from "../application/track.js";
import type { PromiseDeps } from "../application/ports.js";

export const promiseBody = z.object({
  consignment_id: z.string().min(1),
  window_start: z.iso.datetime(),
  window_end: z.iso.datetime(),
  locale: z.string().min(2).default("en-IN"),
});

export const etaBody = z.object({
  eta: z.iso.datetime(),
  locale: z.string().min(2).default("en-IN"),
  channel: z.string().min(1).default("whatsapp"),
});

export const settleBody = z.object({
  milestone: z.string().min(1),
  reason: z.string().optional(),
  locale: z.string().min(2).default("en-IN"),
  channel: z.string().min(1).default("whatsapp"),
});

export interface RouteDeps extends PromiseDeps {
  readonly lookup: CallerLookup;
}

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function promiseRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/promises",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "consignments:write");

      const parsed = promiseBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const made = await promiseDelivery(deps, {
        tenantId: caller.tenantId,
        consignmentId: parsed.data.consignment_id,
        windowStart: new Date(parsed.data.window_start),
        windowEnd: new Date(parsed.data.window_end),
        locale: parsed.data.locale,
      });

      return {
        status: 201,
        body: { promise: made.promise, tracking_token: made.trackingToken },
      };
    },
  };
}

function etaRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/promises/:id/eta",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "consignments:write");

      const parsed = etaBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const updated = await reportEta(deps, {
        tenantId: caller.tenantId,
        consignmentId: request.params["id"] ?? "",
        eta: new Date(parsed.data.eta),
        locale: parsed.data.locale,
        channel: parsed.data.channel,
      });

      return { status: 200, body: updated };
    },
  };
}

function settleRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/promises/:id/settle",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "consignments:write");

      const parsed = settleBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const settled = await settle(deps, {
        tenantId: caller.tenantId,
        consignmentId: request.params["id"] ?? "",
        milestone: parsed.data.milestone,
        locale: parsed.data.locale,
        channel: parsed.data.channel,
        ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
      });

      return { status: 200, body: settled };
    },
  };
}

// The only route with no credential. The link is the credential, and it opens one thin view.
function trackRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/track/:token",
    handle: async (request) => {
      const view = await viewByToken(deps, request.params["token"] ?? "");
      if (view === undefined) {
        throw new DomainError("not_found", "this tracking link is not valid or has expired");
      }
      return { status: 200, body: view, headers: { "cache-control": "no-store" } };
    },
  };
}

export function promiseRoutes(deps: RouteDeps): Route[] {
  return [promiseRoute(deps), etaRoute(deps), settleRoute(deps), trackRoute(deps)];
}
