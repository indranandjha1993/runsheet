import { z } from "zod";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";
import { DomainError } from "../domain/errors.js";
import type { Route } from "../adapters/http.js";
import { observe } from "../application/watch.js";
import { work } from "../application/work.js";
import type { ExceptionsDeps } from "../application/ports.js";
import type { ExceptionEvent } from "../domain/exception.js";

export const observedBody = z.object({
  type: z.string().min(1),
  aggregate_id: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const workBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("triaged"), by: z.string().min(1) }),
  z.object({ type: z.literal("assigned"), to: z.string().min(1) }),
  z.object({ type: z.literal("resolved"), by: z.string().min(1), note: z.string() }),
  z.object({ type: z.literal("auto_resolved"), by: z.string().min(1), note: z.string() }),
  z.object({ type: z.literal("reopened"), reason: z.string().min(1) }),
  z.object({ type: z.literal("waiting_on_customer") }),
  z.object({ type: z.literal("customer_answered") }),
  z.object({ type: z.literal("sla_checked") }),
]);

type WorkBody = z.infer<typeof workBody>;

export interface RouteDeps extends ExceptionsDeps {
  readonly lookup: CallerLookup;
}

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

// The body and the event differ only by the moment it happened, which the caller must not set.
function toEvent(body: WorkBody, at: Date): ExceptionEvent {
  return { ...body, at };
}

function observeRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/observations",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:write");

      const parsed = observedBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const observed = await observe(deps, {
        tenantId: caller.tenantId,
        type: parsed.data.type,
        aggregateId: parsed.data.aggregate_id,
        payload: parsed.data.payload,
      });

      return { status: observed.raised ? 201 : 200, body: observed };
    },
  };
}

function workRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/exceptions/:id/events",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:write");

      const parsed = workBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const exception = await work(deps, {
        tenantId: caller.tenantId,
        exceptionId: request.params["id"] ?? "",
        event: toEvent(parsed.data, deps.clock.now()),
      });

      return { status: 200, body: exception };
    },
  };
}

function queueRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/exceptions",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:read");

      const severity = new URL(request.url, "http://local").searchParams.get("severity");
      const filter = z.enum(["high", "medium", "low"]).safeParse(severity);
      const queue = await deps.repository.queue(
        caller.tenantId,
        filter.success ? filter.data : undefined,
      );

      return { status: 200, body: queue };
    },
  };
}

function readRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/exceptions/:id",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "runs:read");

      const exception = await deps.repository.byId(caller.tenantId, request.params["id"] ?? "");
      if (exception === undefined) {
        throw new DomainError("not_found", "no exception with that identifier");
      }
      return { status: 200, body: exception };
    },
  };
}

export function exceptionsRoutes(deps: RouteDeps): Route[] {
  return [observeRoute(deps), workRoute(deps), queueRoute(deps), readRoute(deps)];
}
