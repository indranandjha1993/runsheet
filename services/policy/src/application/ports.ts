import type { Envelope } from "@runsheet/kernel";
import type { Decision } from "../domain/decision.js";
import type { Policy } from "../domain/policy.js";

export interface PolicyRepository {
  savePolicy(policy: Policy): Promise<void>;
  policyById(tenantId: string, id: string): Promise<Policy | undefined>;
  policiesFor(tenantId: string, triggerEvent: string): Promise<Policy[]>;
  saveDecision(decision: Decision): Promise<void>;
  decisionById(tenantId: string, id: string): Promise<Decision | undefined>;
  decisionsFor(tenantId: string, policyId: string): Promise<Decision[]>;
  decisionsToday(tenantId: string, policyId: string, since: Date): Promise<number>;
  nextSequence(tenantId: string, aggregateId: string): Promise<number>;
}

export interface EventPublisher {
  publish(event: Envelope, payload: Record<string, unknown>, topic: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Identifiers {
  next(): string;
}

export interface PolicyDeps {
  readonly repository: PolicyRepository;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  readonly ids: Identifiers;
}
