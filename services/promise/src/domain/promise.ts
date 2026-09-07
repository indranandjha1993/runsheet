import { DomainError } from "./errors.js";

// Below this, an updated estimate is noise. Telling someone their parcel moved by four minutes
// trains them to ignore the next message, which is the one that mattered.
const MATERIAL_CHANGE_MINUTES = 15;

export interface Promise {
  readonly consignmentId: string;
  readonly tenantId: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly estimatedArrival?: Date;
  readonly lastNotifiedEta?: Date;
  readonly atRisk: boolean;
  readonly notifiable: boolean;
  readonly settled: boolean;
  readonly lastMilestone?: string;
}

export interface MakePromiseCommand {
  readonly consignmentId: string;
  readonly tenantId: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly at: Date;
}

export interface UpdateEtaCommand {
  readonly eta: Date;
  readonly at: Date;
}

export function makePromise(command: MakePromiseCommand): Promise {
  if (command.windowEnd <= command.windowStart) {
    throw new DomainError("invalid_input", "a delivery window must end after it starts");
  }
  if (command.windowEnd < command.at) {
    throw new DomainError("invalid_input", "a delivery window cannot be in the past");
  }

  return {
    consignmentId: command.consignmentId,
    tenantId: command.tenantId,
    windowStart: command.windowStart,
    windowEnd: command.windowEnd,
    atRisk: false,
    notifiable: false,
    settled: false,
  };
}

function movedMaterially(previous: Date | undefined, next: Date): boolean {
  if (previous === undefined) return true;
  return Math.abs(next.getTime() - previous.getTime()) / 60_000 >= MATERIAL_CHANGE_MINUTES;
}

export function updateEta(promise: Promise, command: UpdateEtaCommand): Promise {
  if (promise.settled) return { ...promise, notifiable: false };

  const atRisk = command.eta > promise.windowEnd;
  const changedState = atRisk !== promise.atRisk;
  const notifiable = atRisk || changedState ? movedMaterially(promise.lastNotifiedEta, command.eta) : false;

  return {
    ...promise,
    estimatedArrival: command.eta,
    atRisk,
    notifiable,
    ...(notifiable ? { lastNotifiedEta: command.eta } : {}),
  };
}

export interface PublicView {
  readonly status: "on_track" | "running_late" | "delivered";
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly estimatedArrival: string | null;
  readonly lastMilestone: string | null;
}

// Everything a consignee sees, and nothing else. No name, no phone number, no address, no
// reference to any other consignment. A forwarded link leaks only this.
export function publicView(promise: Promise): PublicView {
  const status = promise.settled ? "delivered" : promise.atRisk ? "running_late" : "on_track";
  return {
    status,
    windowStart: promise.windowStart.toISOString(),
    windowEnd: promise.windowEnd.toISOString(),
    estimatedArrival: promise.estimatedArrival?.toISOString() ?? null,
    lastMilestone: promise.lastMilestone ?? null,
  };
}
