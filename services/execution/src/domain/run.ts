import { DomainError } from "./errors.js";
import { outcomeOf, recordAction, type RecordActionCommand, type Stop } from "./stop.js";

export type RunStatus =
  "planned" | "assigned" | "started" | "suspended" | "completed" | "closed" | "cancelled";

export interface Run {
  readonly id: string;
  readonly tenantId: string;
  readonly hubId: string;
  readonly date: string;
  readonly status: RunStatus;
  readonly stops: readonly Stop[];
  readonly workerId?: string;
  readonly vehicleId?: string;
  readonly declaredCashMinor?: number;
  readonly countedCashMinor?: number;
  readonly forcedClose: boolean;
  readonly suspendReason?: string;
}

export interface PlanRunCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly hubId: string;
  readonly date: string;
  readonly stops: readonly Stop[];
}

export type RunEvent =
  | { type: "assigned"; workerId: string; vehicleId: string }
  | { type: "unassigned" }
  | { type: "started" }
  | { type: "suspended"; reason: string }
  | { type: "action_recorded"; stopId: string; action: RecordActionCommand }
  | { type: "stop_moved"; stopId: string; toRunId: string }
  | { type: "completed" }
  | { type: "cash_declared"; amountMinor: number }
  | { type: "cash_counted"; amountMinor: number }
  | { type: "closed" }
  | { type: "force_closed"; reason: string }
  | { type: "cancelled" };

const READABLE: Record<RunEvent["type"], string> = {
  assigned: "be assigned",
  unassigned: "be unassigned",
  started: "be started",
  suspended: "be suspended",
  action_recorded: "record work",
  stop_moved: "have a stop moved off it",
  completed: "be completed",
  cash_declared: "have cash declared",
  cash_counted: "have cash counted",
  closed: "be closed",
  force_closed: "be forced closed",
  cancelled: "be cancelled",
};

const ALLOWED: Record<RunEvent["type"], readonly RunStatus[]> = {
  assigned: ["planned"],
  unassigned: ["assigned"],
  started: ["assigned", "suspended"],
  suspended: ["started"],
  action_recorded: ["started"],
  stop_moved: ["planned", "assigned", "suspended"],
  completed: ["started"],
  cash_declared: ["completed"],
  cash_counted: ["completed"],
  closed: ["completed"],
  force_closed: ["started", "suspended", "completed"],
  cancelled: ["planned", "assigned"],
};

export function plannedRun(command: PlanRunCommand): Run {
  if (command.stops.length === 0) {
    throw new DomainError("invalid_input", "a run needs at least one stop");
  }
  const positions = new Set(command.stops.map((stop) => stop.sequence));
  if (positions.size !== command.stops.length) {
    throw new DomainError("invalid_input", "two stops cannot share a position");
  }
  return {
    ...command,
    status: "planned",
    stops: [...command.stops].sort((a, b) => a.sequence - b.sequence),
    forcedClose: false,
  };
}

export interface CashSummary {
  readonly collectedMinor: number;
  readonly declaredMinor?: number;
  readonly countedMinor?: number;
  readonly varianceMinor?: number;
}

export function cashSummary(run: Run): CashSummary {
  const collectedMinor = run.stops
    .flatMap((stop) => stop.actions)
    .reduce((total, action) => total + (action.cashCollectedMinor ?? 0), 0);

  const counted = run.countedCashMinor;
  return {
    collectedMinor,
    ...(run.declaredCashMinor === undefined ? {} : { declaredMinor: run.declaredCashMinor }),
    ...(counted === undefined
      ? {}
      : { countedMinor: counted, varianceMinor: counted - collectedMinor }),
  };
}

export function allStopsResolved(run: Run): boolean {
  return run.stops.every((stop) => outcomeOf(stop) !== "pending");
}

export function canClose(run: Run): boolean {
  return run.declaredCashMinor !== undefined && run.countedCashMinor !== undefined;
}

type Handlers = {
  [K in RunEvent["type"]]: (run: Run, event: Extract<RunEvent, { type: K }>) => Run;
};

const HANDLERS: Handlers = {
  assigned: (run, event) => ({
    ...run,
    status: "assigned",
    workerId: event.workerId,
    vehicleId: event.vehicleId,
  }),
  unassigned: (run) => ({ ...run, status: "planned" }),
  started: (run) => ({ ...run, status: "started" }),
  suspended: (run, event) => ({ ...run, status: "suspended", suspendReason: event.reason }),
  action_recorded: (run, event) => ({
    ...run,
    stops: run.stops.map((stop) =>
      stop.id === event.stopId ? recordAction(stop, event.action) : stop,
    ),
  }),
  stop_moved: (run, event) => ({
    ...run,
    stops: run.stops.filter((stop) => stop.id !== event.stopId),
  }),
  completed: (run) => ({ ...run, status: "completed" }),
  cash_declared: (run, event) => ({ ...run, declaredCashMinor: event.amountMinor }),
  cash_counted: (run, event) => ({ ...run, countedCashMinor: event.amountMinor }),
  closed: (run) => ({ ...run, status: "closed" }),
  force_closed: (run, event) => ({
    ...run,
    status: "closed",
    forcedClose: true,
    suspendReason: event.reason,
  }),
  cancelled: (run) => ({ ...run, status: "cancelled" }),
};

function assertPreconditions(run: Run, event: RunEvent): void {
  if (event.type === "completed" && !allStopsResolved(run)) {
    throw new DomainError(
      "transition_not_allowed",
      "every stop must be resolved before a run is completed",
    );
  }
  if (event.type === "closed" && !canClose(run)) {
    throw new DomainError(
      "transition_not_allowed",
      "cash must be declared and counted before a run is closed",
    );
  }
  if (event.type === "action_recorded" && !run.stops.some((s) => s.id === event.stopId)) {
    throw new DomainError("not_found", `this run has no stop ${event.stopId}`);
  }
}

export function applyToRun(run: Run, event: RunEvent): Run {
  if (!ALLOWED[event.type].includes(run.status)) {
    throw new DomainError(
      "transition_not_allowed",
      `a run that is ${run.status} cannot ${READABLE[event.type]}`,
    );
  }
  assertPreconditions(run, event);
  const handler = HANDLERS[event.type] as (r: Run, e: RunEvent) => Run;
  return handler(run, event);
}
