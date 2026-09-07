import { createHash } from "node:crypto";
import { DomainError } from "./errors.js";

// What a policy is allowed to do without asking. Anything touching money defaults to propose.
export const AUTONOMY = ["act", "act_and_notify", "propose", "human_first"] as const;
export type Autonomy = (typeof AUTONOMY)[number];

// A policy must agree with people this often in shadow before anyone may switch it on, over at
// least this many decisions. Both numbers are the whole trust argument, so they live here.
const MINIMUM_AGREEMENT = 0.9;
const MINIMUM_SHADOW_DECISIONS = 100;

export type PolicyState =
  "draft" | "dry_run" | "shadow" | "staged" | "live" | "rolled_back" | "retired";

export interface Policy {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly version: number;
  readonly codeHash: string;
  readonly autonomy: Autonomy;
  readonly triggerEvent: string;
  readonly budgetPerDay: number;
  readonly state: PolicyState;
  readonly rolloutPercent: number;
  readonly dryRunDecisions?: number;
  readonly shadowDecisions?: number;
  readonly agreedWithHumans?: number;
  readonly rolledBackBy?: string;
  readonly rollbackReason?: string;
}

export interface PublishCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly version: number;
  readonly codeHash: string;
  readonly autonomy: Autonomy;
  readonly triggerEvent: string;
  readonly budgetPerDay: number;
}

export function publish(command: PublishCommand): Policy {
  if (!AUTONOMY.includes(command.autonomy)) {
    throw new DomainError("invalid_input", `unknown autonomy level: ${command.autonomy}`);
  }
  if (command.budgetPerDay <= 0) {
    throw new DomainError("invalid_input", "a policy needs a daily budget");
  }
  if (command.codeHash.trim() === "") {
    throw new DomainError("invalid_input", "a policy version needs a code hash");
  }

  return { ...command, state: "draft", rolloutPercent: 0 };
}

export type PolicyEvent =
  | { type: "dry_run_passed"; decisions: number }
  | { type: "shadowed"; decisions: number; agreedWithHumans: number }
  | { type: "staged"; percent: number }
  | { type: "went_live" }
  | { type: "rolled_back"; by: string; reason: string }
  | { type: "retired" };

const ALLOWED: Record<PolicyEvent["type"], readonly PolicyState[]> = {
  dry_run_passed: ["draft"],
  shadowed: ["dry_run"],
  staged: ["shadow", "staged", "live"],
  went_live: ["staged"],
  rolled_back: ["draft", "dry_run", "shadow", "staged", "live"],
  retired: ["live", "rolled_back"],
};

const READABLE: Record<PolicyEvent["type"], string> = {
  dry_run_passed: "pass a dry run",
  shadowed: "be shadowed",
  staged: "be staged",
  went_live: "go live",
  rolled_back: "be rolled back",
  retired: "be retired",
};

function assertPromotable(event: PolicyEvent): void {
  if (event.type === "shadowed") {
    if (event.decisions < MINIMUM_SHADOW_DECISIONS) {
      throw new DomainError(
        "invalid_input",
        `a policy needs at least ${String(MINIMUM_SHADOW_DECISIONS)} shadow decisions before it is promoted`,
      );
    }
    if (event.agreedWithHumans < MINIMUM_AGREEMENT) {
      throw new DomainError(
        "invalid_input",
        `a policy must agree with people on at least ${String(MINIMUM_AGREEMENT * 100)}% of decisions`,
      );
    }
  }
  if (event.type === "staged" && (event.percent < 0 || event.percent > 100)) {
    throw new DomainError("invalid_input", "a rollout must be between 0 and 100 percent");
  }
}

type Handlers = {
  [K in PolicyEvent["type"]]: (policy: Policy, event: Extract<PolicyEvent, { type: K }>) => Policy;
};

const HANDLERS: Handlers = {
  dry_run_passed: (policy, event) => ({
    ...policy,
    state: "dry_run",
    dryRunDecisions: event.decisions,
  }),
  shadowed: (policy, event) => ({
    ...policy,
    state: "shadow",
    shadowDecisions: event.decisions,
    agreedWithHumans: event.agreedWithHumans,
  }),
  staged: (policy, event) => ({ ...policy, state: "staged", rolloutPercent: event.percent }),
  went_live: (policy) => ({ ...policy, state: "live", rolloutPercent: 100 }),
  // A kill switch. It takes effect at once and needs no ceremony, because the moment you want
  // one is the moment something is going wrong.
  rolled_back: (policy, event) => ({
    ...policy,
    state: "rolled_back",
    rolloutPercent: 0,
    rolledBackBy: event.by,
    rollbackReason: event.reason,
  }),
  retired: (policy) => ({ ...policy, state: "retired", rolloutPercent: 0 }),
};

export function applyToPolicy(policy: Policy, event: PolicyEvent): Policy {
  if (!ALLOWED[event.type].includes(policy.state)) {
    throw new DomainError(
      "transition_not_allowed",
      `a policy that is ${policy.state} cannot ${READABLE[event.type]}`,
    );
  }
  assertPromotable(event);
  const handler = HANDLERS[event.type] as (p: Policy, e: PolicyEvent) => Policy;
  return handler(policy, event);
}

// Which subject a staged rollout covers. Deterministic, so the same parcel is always inside or
// always outside, and a decision can be replayed knowing which side it fell.
export function bucketOf(policyId: string, subjectId: string): number {
  const digest = createHash("sha256").update(`${policyId}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

export function inRollout(policy: Policy, subjectId: string): boolean {
  if (policy.state !== "staged" && policy.state !== "live") return false;
  return bucketOf(policy.id, subjectId) < policy.rolloutPercent;
}
