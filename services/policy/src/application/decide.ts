import { applyToDecision, propose, type Decision, type Watermark } from "../domain/decision.js";
import { calibrationOf, type Calibration } from "../domain/calibration.js";
import { applyToPolicy, bucketOf, inRollout, publish, type Policy, type PolicyEvent } from "../domain/policy.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import type { PolicyDeps } from "./ports.js";

export interface PublishPolicyCommand {
  readonly tenantId: string;
  readonly name: string;
  readonly version: number;
  readonly codeHash: string;
  readonly autonomy: Policy["autonomy"];
  readonly triggerEvent: string;
  readonly budgetPerDay: number;
}

export async function publishPolicy(
  deps: PolicyDeps,
  command: PublishPolicyCommand,
): Promise<Policy> {
  const policy = publish({ id: deps.ids.next(), ...command });
  await deps.repository.savePolicy(policy);
  await announce(deps, {
    tenantId: policy.tenantId,
    aggregateType: "policy",
    aggregateId: policy.id,
    type: "policy.published",
    topic: "decision",
    payload: { name: policy.name, version: policy.version, autonomy: policy.autonomy },
  });
  return policy;
}

export interface MovePolicyCommand {
  readonly tenantId: string;
  readonly policyId: string;
  readonly event: PolicyEvent;
}

export async function movePolicy(deps: PolicyDeps, command: MovePolicyCommand): Promise<Policy> {
  const found = await deps.repository.policyById(command.tenantId, command.policyId);
  if (found === undefined) throw new DomainError("not_found", "no policy with that identifier");

  const next = applyToPolicy(found, command.event);
  await deps.repository.savePolicy(next);
  await announce(deps, {
    tenantId: next.tenantId,
    aggregateType: "policy",
    aggregateId: next.id,
    type: `policy.${command.event.type}`,
    topic: "decision",
    payload: { state: next.state, rollout_percent: next.rolloutPercent },
  });
  return next;
}

export interface ConsiderCommand {
  readonly tenantId: string;
  readonly triggerEvent: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly inputs: Record<string, unknown>;
  readonly action: Record<string, unknown>;
  readonly readAt: readonly Watermark[];
  readonly toolCalls?: readonly { tool: string; arguments: Record<string, unknown>; result?: unknown }[];
}

export type Considered =
  | { readonly decided: false; readonly reason: "no_policy" | "outside_rollout" | "budget_spent" }
  | { readonly decided: true; readonly decision: Decision };

function proposalFor(
  deps: PolicyDeps,
  from: { policy: Policy; command: ConsiderCommand; shadow: boolean; spent: number },
): Decision {
  const { policy, command } = from;
  return propose({
    id: deps.ids.next(),
    tenantId: command.tenantId,
    policyId: policy.id,
    policyVersion: policy.version,
    codeHash: policy.codeHash,
    autonomy: policy.autonomy,
    subjectType: command.subjectType,
    subjectId: command.subjectId,
    rolloutBucket: bucketOf(policy.id, command.subjectId),
    rolloutPercent: policy.rolloutPercent,
    budgetRemaining: policy.budgetPerDay - from.spent - 1,
    readAt: command.readAt,
    toolCalls: command.toolCalls ?? [],
    inputs: command.inputs,
    action: command.action,
    shadow: from.shadow,
    at: deps.clock.now(),
  });
}

function startOfDay(at: Date): Date {
  const day = new Date(at);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

// A policy that is shadowed records what it would have done and changes nothing. One that is
// staged acts only for the subjects inside its rollout. Everything else is left alone, and the
// reason is returned rather than silently doing nothing.
export async function consider(deps: PolicyDeps, command: ConsiderCommand): Promise<Considered> {
  const policies = await deps.repository.policiesFor(command.tenantId, command.triggerEvent);
  const policy = policies.find(
    (candidate) =>
      candidate.state === "shadow" || candidate.state === "staged" || candidate.state === "live",
  );
  if (policy === undefined) return { decided: false, reason: "no_policy" };

  const shadow = policy.state === "shadow";
  if (!shadow && !inRollout(policy, command.subjectId)) {
    return { decided: false, reason: "outside_rollout" };
  }

  const spent = await deps.repository.decisionsToday(
    command.tenantId,
    policy.id,
    startOfDay(deps.clock.now()),
  );
  if (spent >= policy.budgetPerDay) return { decided: false, reason: "budget_spent" };

  const decision = proposalFor(deps, { policy, command, shadow, spent });

  await deps.repository.saveDecision(decision);
  await announce(deps, {
    tenantId: decision.tenantId,
    aggregateType: "decision",
    aggregateId: decision.id,
    type: "decision.proposed",
    topic: "decision",
    payload: {
      policy_id: policy.id,
      policy_version: policy.version,
      subject_id: command.subjectId,
      shadow,
      autonomy: policy.autonomy,
    },
  });

  return { decided: true, decision };
}

export interface RecordOutcomeCommand {
  readonly tenantId: string;
  readonly decisionId: string;
  readonly event: Parameters<typeof applyToDecision>[1];
}

export async function recordOutcome(
  deps: PolicyDeps,
  command: RecordOutcomeCommand,
): Promise<Decision> {
  const found = await deps.repository.decisionById(command.tenantId, command.decisionId);
  if (found === undefined) throw new DomainError("not_found", "no decision with that identifier");

  const next = applyToDecision(found, command.event);
  await deps.repository.saveDecision(next);
  await announce(deps, {
    tenantId: next.tenantId,
    aggregateType: "decision",
    aggregateId: next.id,
    type: `decision.${command.event.type}`,
    topic: "decision",
    payload: { policy_id: next.policyId, state: next.state, subject_id: next.subjectId },
  });
  return next;
}

export async function calibration(
  deps: PolicyDeps,
  tenantId: string,
  policyId: string,
): Promise<Calibration> {
  return calibrationOf(await deps.repository.decisionsFor(tenantId, policyId));
}
