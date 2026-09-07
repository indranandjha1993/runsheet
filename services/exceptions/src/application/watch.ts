import { raise, type Exception } from "../domain/exception.js";
import { announce } from "./announce.js";
import type { ExceptionsDeps } from "./ports.js";

export interface ObservedEvent {
  readonly tenantId: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

interface Rule {
  readonly exceptionType: string;
  readonly subjectType: string;
  readonly applies: (payload: Record<string, unknown>) => boolean;
}

const always = (): boolean => true;

// What the rest of the network says, and what it means someone must now deal with. This is the
// whole point of the service: nothing that goes wrong is left for a person to notice.
const RULES: Record<string, Rule> = {
  "run.closed": {
    exceptionType: "cash_variance",
    subjectType: "run",
    applies: (payload) => {
      const cash = payload["cash"] as { varianceMinor?: number } | undefined;
      return cash?.varianceMinor !== undefined && cash.varianceMinor !== 0;
    },
  },
  "run.force_closed": {
    exceptionType: "device_never_synced",
    subjectType: "run",
    applies: always,
  },
  "consignment.attempted": {
    exceptionType: "failed_attempt",
    subjectType: "consignment",
    applies: always,
  },
  "consignment.lost": { exceptionType: "parcel_lost", subjectType: "consignment", applies: always },
  "consignment.damaged": {
    exceptionType: "parcel_damaged",
    subjectType: "consignment",
    applies: always,
  },
  "address.resolved": {
    exceptionType: "address_unclear",
    subjectType: "address",
    applies: (payload) => ((payload["confidence"] as number | undefined) ?? 1) < 0.3,
  },
};

export interface Observation {
  readonly raised: boolean;
  readonly exception?: Exception;
  readonly reason?: "no_rule" | "rule_did_not_apply" | "already_open";
}

// Raising is idempotent by problem and subject, so replaying a stream never produces duplicates.
export async function observe(deps: ExceptionsDeps, event: ObservedEvent): Promise<Observation> {
  const rule = RULES[event.type];
  if (rule === undefined) return { raised: false, reason: "no_rule" };
  if (!rule.applies(event.payload)) return { raised: false, reason: "rule_did_not_apply" };

  const open = await deps.repository.openFor(event.tenantId, rule.exceptionType, event.aggregateId);
  if (open !== undefined) return { raised: false, exception: open, reason: "already_open" };

  const exception = raise({
    id: deps.ids.next(),
    tenantId: event.tenantId,
    type: rule.exceptionType,
    subjectType: rule.subjectType,
    subjectId: event.aggregateId,
    detail: event.payload,
    at: deps.clock.now(),
  });

  await deps.repository.save(exception);
  await announce(deps, {
    tenantId: exception.tenantId,
    aggregateType: "exception",
    aggregateId: exception.id,
    type: "exception.raised",
    topic: "exception",
    payload: {
      exception_type: exception.type,
      severity: exception.severity,
      subject_type: exception.subjectType,
      subject_id: exception.subjectId,
    },
  });

  return { raised: true, exception };
}
