import { DomainError } from "./errors.js";
import { breached, pause, resume, startClock, type SlaClock } from "./sla.js";

export type Severity = "high" | "medium" | "low";

// What can go wrong, how urgent it is, and how long someone has. Money and safety problems get
// the tightest clocks because they cost the most to leave alone.
const TYPES: Record<string, { severity: Severity; allowanceMinutes: number }> = {
  cash_short: { severity: "high", allowanceMinutes: 240 },
  cash_variance: { severity: "high", allowanceMinutes: 240 },
  delivery_disputed: { severity: "high", allowanceMinutes: 480 },
  parcel_lost: { severity: "high", allowanceMinutes: 480 },
  parcel_damaged: { severity: "medium", allowanceMinutes: 720 },
  sla_at_risk: { severity: "medium", allowanceMinutes: 120 },
  failed_attempt: { severity: "medium", allowanceMinutes: 720 },
  unexpected_parcel: { severity: "medium", allowanceMinutes: 720 },
  device_never_synced: { severity: "medium", allowanceMinutes: 720 },
  address_unclear: { severity: "low", allowanceMinutes: 1440 },
  inconsistent_sequence: { severity: "low", allowanceMinutes: 1440 },
};

export type ExceptionState = "raised" | "triaged" | "assigned" | "resolved";

export interface Exception {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly detail: Record<string, unknown>;
  readonly severity: Severity;
  readonly state: ExceptionState;
  readonly clock: SlaClock;
  readonly slaBreached: boolean;
  readonly reopenCount: number;
  readonly assignedTo?: string;
  readonly resolvedBy?: string;
  readonly resolutionNote?: string;
  readonly resolvedAutomatically: boolean;
}

export interface RaiseCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly detail: Record<string, unknown>;
  readonly at: Date;
}

export type ExceptionEvent =
  | { type: "triaged"; by: string; at: Date }
  | { type: "assigned"; to: string; at: Date }
  | { type: "resolved"; by: string; note: string; at: Date }
  | { type: "auto_resolved"; by: string; note: string; at: Date }
  | { type: "reopened"; reason: string; at: Date }
  | { type: "waiting_on_customer"; at: Date }
  | { type: "customer_answered"; at: Date }
  | { type: "sla_checked"; at: Date };

export function severityOf(type: string): Severity {
  const known = TYPES[type];
  if (known === undefined)
    throw new DomainError("invalid_input", `unknown exception type: ${type}`);
  return known.severity;
}

// The same problem on the same subject is one exception, however many times it is noticed.
// Without this, replaying an event stream raises the same exception again and again.
export function keyOf(exception: Pick<Exception, "tenantId" | "type" | "subjectId">): string {
  return `${exception.tenantId}:${exception.type}:${exception.subjectId}`;
}

export function raise(command: RaiseCommand): Exception {
  const known = TYPES[command.type];
  if (known === undefined) {
    throw new DomainError("invalid_input", `unknown exception type: ${command.type}`);
  }

  return {
    id: command.id,
    tenantId: command.tenantId,
    type: command.type,
    subjectType: command.subjectType,
    subjectId: command.subjectId,
    detail: command.detail,
    severity: known.severity,
    state: "raised",
    clock: startClock({ startedAt: command.at, allowanceMinutes: known.allowanceMinutes }),
    slaBreached: false,
    reopenCount: 0,
    resolvedAutomatically: false,
  };
}

const ALLOWED: Record<ExceptionEvent["type"], readonly ExceptionState[]> = {
  triaged: ["raised"],
  assigned: ["raised", "triaged"],
  resolved: ["raised", "triaged", "assigned"],
  auto_resolved: ["raised", "triaged", "assigned"],
  reopened: ["resolved"],
  waiting_on_customer: ["raised", "triaged", "assigned"],
  customer_answered: ["raised", "triaged", "assigned"],
  sla_checked: ["raised", "triaged", "assigned", "resolved"],
};

const READABLE: Record<ExceptionEvent["type"], string> = {
  triaged: "be triaged",
  assigned: "be assigned",
  resolved: "be resolved",
  auto_resolved: "be resolved automatically",
  reopened: "be reopened",
  waiting_on_customer: "wait on a customer",
  customer_answered: "record a customer answer",
  sla_checked: "have its clock checked",
};

type Handlers = {
  [K in ExceptionEvent["type"]]: (
    exception: Exception,
    event: Extract<ExceptionEvent, { type: K }>,
  ) => Exception;
};

const HANDLERS: Handlers = {
  triaged: (exception) => ({ ...exception, state: "triaged" }),
  assigned: (exception, event) => ({ ...exception, state: "assigned", assignedTo: event.to }),
  resolved: (exception, event) => ({
    ...exception,
    state: "resolved",
    resolvedBy: event.by,
    resolutionNote: event.note,
  }),
  auto_resolved: (exception, event) => ({
    ...exception,
    state: "resolved",
    resolvedBy: event.by,
    resolutionNote: event.note,
    resolvedAutomatically: true,
  }),
  reopened: (exception, event) => ({
    ...exception,
    state: "raised",
    reopenCount: exception.reopenCount + 1,
    resolutionNote: event.reason,
  }),
  waiting_on_customer: (exception, event) => ({
    ...exception,
    clock: pause(exception.clock, event.at),
  }),
  customer_answered: (exception, event) => ({
    ...exception,
    clock: resume(exception.clock, event.at),
  }),
  // A breach is a flag, never a state. An overdue exception is still open and still someone's.
  sla_checked: (exception, event) => ({
    ...exception,
    slaBreached: breached(exception.clock, event.at),
  }),
};

function assertResolvable(event: ExceptionEvent): void {
  const resolving = event.type === "resolved" || event.type === "auto_resolved";
  if (resolving && event.note.trim() === "") {
    throw new DomainError("invalid_input", "a resolution needs a note");
  }
}

export function applyToException(exception: Exception, event: ExceptionEvent): Exception {
  if (!ALLOWED[event.type].includes(exception.state)) {
    throw new DomainError(
      "transition_not_allowed",
      `an exception that is ${exception.state} cannot ${READABLE[event.type]}`,
    );
  }
  assertResolvable(event);
  const handler = HANDLERS[event.type] as (e: Exception, v: ExceptionEvent) => Exception;
  return handler(exception, event);
}
