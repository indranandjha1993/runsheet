import { DomainError } from "./errors.js";

export type Status =
  | "booked"
  | "picked_up"
  | "in_hub"
  | "in_transit"
  | "out_for_delivery"
  | "attempted"
  | "delivered"
  | "rto_initiated"
  | "rto_out_for_delivery"
  | "rto_delivered"
  | "cancelled"
  | "lost";

export interface Guards {
  readonly proofRequirement: string;
  readonly attemptLimit: number;
  readonly codAmountMinor?: number;
  readonly codCurrency?: string;
  readonly codToleranceMinor?: number;
}

export interface Package {
  readonly id: string;
  readonly weightGrams: number;
}

export interface BookCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly orderId: string;
  readonly service: string;
  readonly paymentMode: "prepaid" | "cod";
  readonly guards: Guards;
  readonly packages: readonly Package[];
}

export interface Consignment extends BookCommand {
  readonly status: Status;
  readonly attemptCount: number;
  readonly pickupAttempts: number;
  readonly damaged: boolean;
  readonly cancelRequested: boolean;
  readonly currentHubId?: string;
  readonly currentRunId?: string;
}

export type ConsignmentEvent =
  | { type: "pickup_attempted"; ndrReason: string; proofId: string }
  | { type: "picked_up" }
  | { type: "inscanned"; hubId: string }
  | { type: "departed_hub" }
  | { type: "out_for_delivery"; runId: string }
  | { type: "attempted"; ndrReason: string; proofId: string }
  | { type: "delivered"; proofId: string; cashCollectedMinor?: number }
  | { type: "rto_initiated" }
  | { type: "rto_out_for_delivery"; runId: string }
  | { type: "rto_attempted"; ndrReason: string; proofId: string }
  | { type: "rto_delivered"; proofId: string }
  | { type: "cancelled" }
  | { type: "cancel_requested" }
  | { type: "lost" }
  | { type: "found"; hubId: string }
  | { type: "damaged"; note: string };

// Every transition event has an entry; a missing one is a programming error the tests catch.
const READABLE: Record<ConsignmentEvent["type"], string> = {
  pickup_attempted: "have its pickup attempted",
  picked_up: "be picked up",
  inscanned: "be scanned into a hub",
  departed_hub: "depart a hub",
  out_for_delivery: "go out for delivery",
  attempted: "have a delivery attempted",
  delivered: "be delivered",
  rto_initiated: "start a return",
  rto_out_for_delivery: "go out on a return",
  rto_attempted: "have a return attempted",
  rto_delivered: "be returned",
  cancelled: "be cancelled",
  lost: "be marked lost",
  found: "be found",
  damaged: "be marked damaged",
  cancel_requested: "have a cancellation requested",
};

// Which statuses each event may be applied from. Flags (damaged, cancel_requested) are not
// transitions and are allowed at any point before the consignment reaches an end state.
const ALLOWED: Record<string, readonly Status[]> = {
  pickup_attempted: ["booked"],
  picked_up: ["booked"],
  inscanned: ["picked_up", "in_transit", "out_for_delivery", "attempted", "lost"],
  departed_hub: ["in_hub"],
  out_for_delivery: ["picked_up", "in_hub", "attempted"],
  attempted: ["out_for_delivery"],
  delivered: ["out_for_delivery"],
  rto_initiated: ["picked_up", "in_hub", "in_transit", "out_for_delivery", "attempted"],
  rto_out_for_delivery: ["rto_initiated"],
  rto_attempted: ["rto_out_for_delivery"],
  rto_delivered: ["rto_out_for_delivery"],
  cancelled: ["booked"],
  lost: ["picked_up", "in_hub", "in_transit", "out_for_delivery", "attempted"],
  found: ["lost"],
};

const TERMINAL: readonly Status[] = ["delivered", "rto_delivered", "cancelled"];

export function book(command: BookCommand): Consignment {
  if (command.packages.length === 0) {
    throw new DomainError("invalid_input", "a consignment needs at least one package");
  }
  if (
    command.paymentMode === "cod" &&
    (command.guards.codAmountMinor === undefined || command.guards.codCurrency === undefined)
  ) {
    throw new DomainError("invalid_input", "cash on delivery needs an amount and a currency");
  }
  if (command.guards.attemptLimit < 1) {
    throw new DomainError("invalid_input", "the attempt limit must be at least one");
  }

  return {
    ...command,
    status: "booked",
    attemptCount: 0,
    pickupAttempts: 0,
    damaged: false,
    cancelRequested: false,
  };
}

export function can(current: Consignment, event: ConsignmentEvent): boolean {
  if (event.type === "damaged" || event.type === "cancel_requested") {
    return !TERMINAL.includes(current.status);
  }
  return ALLOWED[event.type]?.includes(current.status) ?? false;
}

function assertDeliverable(current: Consignment, cashCollectedMinor: number | undefined): void {
  if (current.paymentMode !== "cod") return;
  const expected = current.guards.codAmountMinor ?? 0;
  const tolerance = current.guards.codToleranceMinor ?? 0;
  if (cashCollectedMinor === undefined) {
    throw new DomainError(
      "invalid_input",
      "cash on delivery must be collected before delivery",
    );
  }
  if (Math.abs(cashCollectedMinor - expected) > tolerance) {
    throw new DomainError(
      "invalid_input",
      `cash collected differs from the amount due by more than the tolerance`,
    );
  }
}

// A failed attempt does not move the parcel. It is still on the van until the hub scans it back
// in, so the status records the attempt and the physical scan does the moving.
function afterAttempt(current: Consignment): Consignment {
  return { ...current, attemptCount: current.attemptCount + 1, status: "attempted" };
}

// Whether the parcel should now go back to the shipper rather than be tried again. The decision
// is the caller's; this only states the condition.
export function mustReturn(current: Consignment): boolean {
  return current.cancelRequested || current.attemptCount >= current.guards.attemptLimit;
}

// Each handler receives its own event variant, so no handler has to narrow or cast.
type Handlers = {
  [K in ConsignmentEvent["type"]]: (
    current: Consignment,
    event: Extract<ConsignmentEvent, { type: K }>,
  ) => Consignment;
};

const to =
  (status: Status) =>
  (current: Consignment): Consignment => ({ ...current, status });

const TRANSITIONS: Handlers = {
  pickup_attempted: (current) => ({
    ...current,
    pickupAttempts: current.pickupAttempts + 1,
    status: "booked",
  }),
  picked_up: to("picked_up"),
  inscanned: (current, event) => ({ ...current, status: "in_hub", currentHubId: event.hubId }),
  departed_hub: to("in_transit"),
  out_for_delivery: (current, event) => ({
    ...current,
    status: "out_for_delivery",
    currentRunId: event.runId,
  }),
  attempted: afterAttempt,
  delivered: to("delivered"),
  rto_initiated: to("rto_initiated"),
  rto_out_for_delivery: (current, event) => ({
    ...current,
    status: "rto_out_for_delivery",
    currentRunId: event.runId,
  }),
  rto_attempted: to("rto_initiated"),
  rto_delivered: to("rto_delivered"),
  cancelled: to("cancelled"),
  lost: to("lost"),
  found: (current, event) => ({ ...current, status: "in_hub", currentHubId: event.hubId }),
  damaged: (current) => ({ ...current, damaged: true }),
  cancel_requested: (current) => ({ ...current, cancelRequested: true }),
};

// TypeScript cannot correlate the looked-up handler with the event variant, so the cast is
// contained here rather than repeated in every handler.
function runTransition(current: Consignment, event: ConsignmentEvent): Consignment {
  const handler = TRANSITIONS[event.type] as (c: Consignment, e: ConsignmentEvent) => Consignment;
  return handler(current, event);
}

function assertReasoned(event: ConsignmentEvent): void {
  const reasoned =
    event.type === "attempted" ||
    event.type === "rto_attempted" ||
    event.type === "pickup_attempted";
  if (reasoned && event.ndrReason.trim() === "") {
    throw new DomainError("invalid_input", "a failed attempt needs a reason");
  }
}

export function apply(current: Consignment, event: ConsignmentEvent): Consignment {
  if (!can(current, event)) {
    const what = READABLE[event.type];
    throw new DomainError(
      "transition_not_allowed",
      `a consignment that is ${current.status} cannot ${what}`,
    );
  }
  assertReasoned(event);
  if (event.type === "delivered") assertDeliverable(current, event.cashCollectedMinor);
  return runTransition(current, event);
}
