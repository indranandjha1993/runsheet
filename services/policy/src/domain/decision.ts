import { DomainError } from "./errors.js";
import type { Autonomy } from "./policy.js";

export interface Watermark {
  readonly topic: string;
  readonly partition: number;
  readonly offset: number;
}

export interface ToolCall {
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
  readonly result?: unknown;
}

export interface ModelExchange {
  readonly prompt: string;
  readonly response: string;
  readonly parameters: Record<string, unknown>;
}

export type DecisionState =
  | "proposed"
  | "approved"
  | "executed"
  | "rejected"
  | "reversed"
  | "failed"
  | "expired"
  | "shadow_recorded";

export interface Decision {
  readonly id: string;
  readonly tenantId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly codeHash: string;
  readonly autonomy: Autonomy;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly rolloutBucket: number;
  readonly rolloutPercent: number;
  readonly budgetRemaining: number;
  /** Exactly where in each stream the policy was reading. Without this a replay is a guess. */
  readonly readAt: readonly Watermark[];
  readonly toolCalls: readonly ToolCall[];
  readonly inputs: Record<string, unknown>;
  readonly action: Record<string, unknown>;
  readonly state: DecisionState;
  readonly proposedAt: Date;
  readonly shadow: boolean;
  readonly modelVersion?: string;
  readonly modelExchange?: ModelExchange | undefined;
  readonly producedEventIds?: readonly string[];
  readonly reviewedBy?: string;
  readonly reversalReason?: string;
}

export interface ProposeCommand extends Omit<Decision, "state" | "proposedAt" | "shadow"> {
  readonly at: Date;
  readonly shadow?: boolean;
}

export function propose(command: ProposeCommand): Decision {
  if (command.readAt.length === 0) {
    throw new DomainError("invalid_input", "a decision must record what it read");
  }
  if (command.codeHash.trim() === "") {
    throw new DomainError("invalid_input", "a decision must record which code produced it");
  }

  // Built field by field rather than spread, so nothing from the command leaks onto the record.
  // A decision carries exactly what a replay needs and nothing else.
  return {
    id: command.id,
    tenantId: command.tenantId,
    policyId: command.policyId,
    policyVersion: command.policyVersion,
    codeHash: command.codeHash,
    autonomy: command.autonomy,
    subjectType: command.subjectType,
    subjectId: command.subjectId,
    rolloutBucket: command.rolloutBucket,
    rolloutPercent: command.rolloutPercent,
    budgetRemaining: command.budgetRemaining,
    readAt: command.readAt,
    toolCalls: command.toolCalls,
    inputs: command.inputs,
    action: command.action,
    state: "proposed",
    proposedAt: command.at,
    shadow: command.shadow ?? false,
    ...(command.modelVersion === undefined ? {} : { modelVersion: command.modelVersion }),
    ...(command.modelExchange === undefined ? {} : { modelExchange: command.modelExchange }),
  };
}

// Whether this decision could be run again and be expected to produce the same answer. A model
// that was consulted but whose exchange was not kept makes that impossible, and saying so is
// more honest than a replay that quietly diverges.
export function replayable(decision: Decision): {
  replayable: boolean;
  missing: readonly string[];
} {
  const missing: string[] = [];

  for (const call of decision.toolCalls) {
    if (call.result === undefined) missing.push(`tool_result:${call.tool}`);
  }
  if (decision.modelVersion !== undefined && decision.modelExchange === undefined) {
    missing.push("model_exchange");
  }

  return { replayable: missing.length === 0, missing };
}

export type DecisionEvent =
  | { type: "approved"; by: string; at: Date }
  | { type: "rejected"; by: string; reason: string; at: Date }
  | { type: "executed"; producedEventIds: readonly string[]; at: Date }
  | { type: "reversed"; by: string; reason: string; at: Date }
  | { type: "failed"; reason: string; at: Date }
  | { type: "expired"; at: Date }
  | { type: "shadow_recorded"; wouldHaveDone: string; at: Date };

const ALLOWED: Record<DecisionEvent["type"], readonly DecisionState[]> = {
  approved: ["proposed"],
  rejected: ["proposed"],
  executed: ["proposed", "approved"],
  reversed: ["executed"],
  failed: ["executed"],
  expired: ["proposed", "approved"],
  shadow_recorded: ["proposed"],
};

const READABLE: Record<DecisionEvent["type"], string> = {
  approved: "be approved",
  rejected: "be rejected",
  executed: "be executed",
  reversed: "be reversed",
  failed: "be marked failed",
  expired: "expire",
  shadow_recorded: "be recorded as shadow",
};

const NEEDS_APPROVAL: readonly Autonomy[] = ["propose", "human_first"];

function assertExecutable(decision: Decision, event: DecisionEvent): void {
  if (event.type !== "executed") return;
  if (decision.shadow) {
    throw new DomainError("transition_not_allowed", "a shadow decision never executes");
  }
  if (NEEDS_APPROVAL.includes(decision.autonomy) && decision.state !== "approved") {
    throw new DomainError(
      "transition_not_allowed",
      "a decision this policy only proposes cannot be executed until it is approved",
    );
  }
}

type Handlers = {
  [K in DecisionEvent["type"]]: (
    decision: Decision,
    event: Extract<DecisionEvent, { type: K }>,
  ) => Decision;
};

const HANDLERS: Handlers = {
  approved: (decision, event) => ({ ...decision, state: "approved", reviewedBy: event.by }),
  rejected: (decision, event) => ({
    ...decision,
    state: "rejected",
    reviewedBy: event.by,
    reversalReason: event.reason,
  }),
  executed: (decision, event) => ({
    ...decision,
    state: "executed",
    producedEventIds: event.producedEventIds,
  }),
  reversed: (decision, event) => ({
    ...decision,
    state: "reversed",
    reviewedBy: event.by,
    reversalReason: event.reason,
  }),
  failed: (decision, event) => ({ ...decision, state: "failed", reversalReason: event.reason }),
  expired: (decision) => ({ ...decision, state: "expired" }),
  shadow_recorded: (decision) => ({ ...decision, state: "shadow_recorded" }),
};

export function applyToDecision(decision: Decision, event: DecisionEvent): Decision {
  if (!ALLOWED[event.type].includes(decision.state)) {
    throw new DomainError(
      "transition_not_allowed",
      `a decision that is ${decision.state} cannot ${READABLE[event.type]}`,
    );
  }
  assertExecutable(decision, event);
  const handler = HANDLERS[event.type] as (d: Decision, e: DecisionEvent) => Decision;
  return handler(decision, event);
}
