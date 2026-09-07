import { DomainError } from "./errors.js";

export type ActionKind = "deliver" | "pickup" | "return";
export type ActionResult = "done" | "failed" | "skipped";
export type StopOutcome = "pending" | "completed" | "partially_completed" | "failed" | "skipped";

export interface StopAction {
  readonly id: string;
  readonly kind: ActionKind;
  readonly consignmentId: string;
  readonly result?: ActionResult;
  readonly ndrReason?: string;
  readonly proofId?: string;
  readonly cashCollectedMinor?: number;
}

export interface Stop {
  readonly id: string;
  readonly sequence: number;
  readonly state: "pending" | "en_route" | "arrived";
  readonly actions: readonly StopAction[];
}

export interface PlanStopCommand {
  readonly id: string;
  readonly sequence: number;
  readonly actions: readonly Omit<StopAction, "result" | "ndrReason" | "proofId">[];
}

export interface RecordActionCommand {
  readonly actionId: string;
  readonly result: ActionResult;
  readonly ndrReason?: string;
  readonly proofId?: string;
  readonly cashCollectedMinor?: number;
}

export function plannedStop(command: PlanStopCommand): Stop {
  if (command.actions.length === 0) {
    throw new DomainError("invalid_input", "a stop needs at least one action");
  }
  return { id: command.id, sequence: command.sequence, state: "pending", actions: command.actions };
}

function assertRecordable(action: StopAction, command: RecordActionCommand): void {
  if (action.result !== undefined) {
    throw new DomainError("transition_not_allowed", `action ${action.id} already has an outcome`);
  }
  if (command.result !== "done" && (command.ndrReason ?? "").trim() === "") {
    throw new DomainError(
      "invalid_input",
      command.result === "failed"
        ? "a failed action needs a reason"
        : "a skipped action needs a reason",
    );
  }
  if (command.result === "done" && command.proofId === undefined) {
    throw new DomainError("invalid_input", "a completed action needs a proof");
  }
}

export function recordAction(stop: Stop, command: RecordActionCommand): Stop {
  const action = stop.actions.find((candidate) => candidate.id === command.actionId);
  if (action === undefined) {
    throw new DomainError("not_found", `this stop has no action ${command.actionId}`);
  }
  assertRecordable(action, command);

  const updated: StopAction = {
    ...action,
    result: command.result,
    ...(command.ndrReason === undefined ? {} : { ndrReason: command.ndrReason }),
    ...(command.proofId === undefined ? {} : { proofId: command.proofId }),
    ...(command.cashCollectedMinor === undefined
      ? {}
      : { cashCollectedMinor: command.cashCollectedMinor }),
  };

  return {
    ...stop,
    state: "arrived",
    actions: stop.actions.map((candidate) => (candidate.id === action.id ? updated : candidate)),
  };
}

// The stop has no state of its own once work begins: its outcome is what its actions say.
export function outcomeOf(stop: Stop): StopOutcome {
  const results = stop.actions.map((action) => action.result);
  if (results.some((result) => result === undefined)) return "pending";
  if (results.every((result) => result === "done")) return "completed";
  if (results.every((result) => result === "skipped")) return "skipped";
  if (results.some((result) => result === "done")) return "partially_completed";
  return "failed";
}
