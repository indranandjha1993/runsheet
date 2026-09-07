import type { Envelope } from "@runsheet/kernel";
import type { Decision } from "../domain/decision.js";
import type { Policy } from "../domain/policy.js";
import type { Clock, EventPublisher, Identifiers, PolicyRepository } from "./ports.js";

/* eslint-disable max-lines-per-function -- one cohesive fake of a repository interface */
export function inMemoryPolicies(): PolicyRepository {
  const policies = new Map<string, Policy>();
  const decisions = new Map<string, Decision>();
  const sequences = new Map<string, number>();
  const key = (tenantId: string, rest: string): string => `${tenantId}:${rest}`;

  return {
    savePolicy: (policy) => {
      policies.set(key(policy.tenantId, policy.id), policy);
      return Promise.resolve();
    },
    policyById: (tenantId, id) => Promise.resolve(policies.get(key(tenantId, id))),
    allPolicies: (tenantId) =>
      Promise.resolve([...policies.values()].filter((policy) => policy.tenantId === tenantId)),
    policiesFor: (tenantId, triggerEvent) =>
      Promise.resolve(
        [...policies.values()].filter(
          (policy) => policy.tenantId === tenantId && policy.triggerEvent === triggerEvent,
        ),
      ),
    saveDecision: (decision) => {
      decisions.set(key(decision.tenantId, decision.id), decision);
      return Promise.resolve();
    },
    decisionById: (tenantId, id) => Promise.resolve(decisions.get(key(tenantId, id))),
    decisionsFor: (tenantId, policyId) =>
      Promise.resolve(
        [...decisions.values()].filter(
          (decision) => decision.tenantId === tenantId && decision.policyId === policyId,
        ),
      ),
    decisionsToday: (tenantId, policyId, since) =>
      Promise.resolve(
        [...decisions.values()].filter(
          (decision) =>
            decision.tenantId === tenantId &&
            decision.policyId === policyId &&
            decision.proposedAt >= since,
        ).length,
      ),
    nextSequence: (tenantId, aggregateId) => {
      const at = key(tenantId, aggregateId);
      const next = (sequences.get(at) ?? 0) + 1;
      sequences.set(at, next);
      return Promise.resolve(next);
    },
  };
}

export interface Published {
  event: Envelope;
  payload: Record<string, unknown>;
  topic: string;
}

export function recordingPublisher(): EventPublisher & { published: Published[] } {
  const published: Published[] = [];
  return {
    published,
    publish: (event, payload, topic) => {
      published.push({ event, payload, topic });
      return Promise.resolve();
    },
  };
}

export function fixedClock(at: string): Clock {
  return { now: () => new Date(at) };
}

export function countingIds(): Identifiers {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `01J8Z0T00000000000000${String(n).padStart(5, "0")}`;
    },
  };
}
