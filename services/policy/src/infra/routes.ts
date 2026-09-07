import { z } from "zod";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";
import { DomainError } from "../domain/errors.js";
import { replayable } from "../domain/decision.js";
import type { Route } from "../adapters/http.js";
import {
  calibration,
  consider,
  movePolicy,
  publishPolicy,
  recordOutcome,
} from "../application/decide.js";
import type { PolicyDeps } from "../application/ports.js";

const publishBody = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  code_hash: z.string().min(1),
  autonomy: z.enum(["act", "act_and_notify", "propose", "human_first"]),
  trigger_event: z.string().min(1),
  budget_per_day: z.number().int().positive(),
});

const moveBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dry_run_passed"), decisions: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("shadowed"),
    decisions: z.number().int().nonnegative(),
    agreed_with_humans: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal("staged"), percent: z.number().int() }),
  z.object({ type: z.literal("went_live") }),
  z.object({ type: z.literal("rolled_back"), by: z.string().min(1), reason: z.string().min(1) }),
  z.object({ type: z.literal("retired") }),
]);

const considerBody = z.object({
  trigger_event: z.string().min(1),
  subject_type: z.string().min(1),
  subject_id: z.string().min(1),
  inputs: z.record(z.string(), z.unknown()).default({}),
  action: z.record(z.string(), z.unknown()).default({}),
  read_at: z
    .array(
      z.object({
        topic: z.string().min(1),
        partition: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

const outcomeBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approved"), by: z.string().min(1) }),
  z.object({ type: z.literal("rejected"), by: z.string().min(1), reason: z.string().min(1) }),
  z.object({ type: z.literal("executed"), produced_event_ids: z.array(z.string()).default([]) }),
  z.object({ type: z.literal("reversed"), by: z.string().min(1), reason: z.string().min(1) }),
  z.object({ type: z.literal("failed"), reason: z.string().min(1) }),
  z.object({ type: z.literal("shadow_recorded"), would_have_done: z.string().min(1) }),
]);

type MoveBody = z.infer<typeof moveBody>;
type OutcomeBody = z.infer<typeof outcomeBody>;

export interface RouteDeps extends PolicyDeps {
  readonly lookup: CallerLookup;
}

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function toPolicyEvent(body: MoveBody): Parameters<typeof movePolicy>[1]["event"] {
  if (body.type === "shadowed") {
    return {
      type: "shadowed",
      decisions: body.decisions,
      agreedWithHumans: body.agreed_with_humans,
    };
  }
  return body;
}

function toDecisionEvent(body: OutcomeBody, at: Date): Parameters<typeof recordOutcome>[1]["event"] {
  if (body.type === "executed") {
    return { type: "executed", producedEventIds: body.produced_event_ids, at };
  }
  if (body.type === "shadow_recorded") {
    return { type: "shadow_recorded", wouldHaveDone: body.would_have_done, at };
  }
  return { ...body, at };
}

function publishRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/policies",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "policies:write");

      const parsed = publishBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const policy = await publishPolicy(deps, {
        tenantId: caller.tenantId,
        name: parsed.data.name,
        version: parsed.data.version,
        codeHash: parsed.data.code_hash,
        autonomy: parsed.data.autonomy,
        triggerEvent: parsed.data.trigger_event,
        budgetPerDay: parsed.data.budget_per_day,
      });

      return { status: 201, body: policy };
    },
  };
}

function moveRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/policies/:id/events",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "policies:write");

      const parsed = moveBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const policy = await movePolicy(deps, {
        tenantId: caller.tenantId,
        policyId: request.params["id"] ?? "",
        event: toPolicyEvent(parsed.data),
      });

      return { status: 200, body: policy };
    },
  };
}

function considerRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/decisions",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "policies:write");

      const parsed = considerBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const considered = await consider(deps, {
        tenantId: caller.tenantId,
        triggerEvent: parsed.data.trigger_event,
        subjectType: parsed.data.subject_type,
        subjectId: parsed.data.subject_id,
        inputs: parsed.data.inputs,
        action: parsed.data.action,
        readAt: parsed.data.read_at,
      });

      return { status: considered.decided ? 201 : 200, body: considered };
    },
  };
}

function outcomeRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/decisions/:id/events",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "policies:write");

      const parsed = outcomeBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const decision = await recordOutcome(deps, {
        tenantId: caller.tenantId,
        decisionId: request.params["id"] ?? "",
        event: toDecisionEvent(parsed.data, deps.clock.now()),
      });

      return { status: 200, body: decision };
    },
  };
}

// Whether a decision could be run again and expected to produce the same answer, and what is
// missing if it could not. This is the question the whole ledger exists to answer.
function replayRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/decisions/:id/replayable",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "policies:read");

      const decision = await deps.repository.decisionById(
        caller.tenantId,
        request.params["id"] ?? "",
      );
      if (decision === undefined) {
        throw new DomainError("not_found", "no decision with that identifier");
      }

      return { status: 200, body: { decision, ...replayable(decision) } };
    },
  };
}

function calibrationRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/policies/:id/calibration",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "policies:read");

      const report = await calibration(deps, caller.tenantId, request.params["id"] ?? "");
      return { status: 200, body: report };
    },
  };
}

export function policyRoutes(deps: RouteDeps): Route[] {
  return [
    publishRoute(deps),
    moveRoute(deps),
    considerRoute(deps),
    outcomeRoute(deps),
    replayRoute(deps),
    calibrationRoute(deps),
  ];
}
