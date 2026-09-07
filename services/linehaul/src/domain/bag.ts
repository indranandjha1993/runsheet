import { DomainError } from "./errors.js";

export type BagStatus = "open" | "sealed" | "in_transit" | "received" | "emptied";

export interface Bag {
  readonly id: string;
  readonly tenantId: string;
  readonly originHubId: string;
  readonly destinationHubId: string;
  readonly status: BagStatus;
  readonly consignmentIds: readonly string[];
  readonly sealNumber?: string;
  readonly tripId?: string;
  readonly receivedAtHubId?: string;
  readonly sealBroken: boolean;
  readonly misrouted: boolean;
  readonly missingIds: readonly string[];
  readonly unexpectedIds: readonly string[];
}

export interface OpenBagCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly originHubId: string;
  readonly destinationHubId: string;
}

export type BagEvent =
  | { type: "parcel_added"; consignmentId: string }
  | { type: "parcel_removed"; consignmentId: string }
  | { type: "sealed"; sealNumber: string }
  | { type: "loaded"; tripId: string }
  | { type: "received"; hubId: string; sealIntact: boolean }
  | { type: "emptied"; scannedIds: readonly string[] };

export function openBag(command: OpenBagCommand): Bag {
  if (command.originHubId === command.destinationHubId) {
    throw new DomainError("invalid_input", "a bag cannot travel to the hub it is in");
  }

  return {
    ...command,
    status: "open",
    consignmentIds: [],
    sealBroken: false,
    misrouted: false,
    missingIds: [],
    unexpectedIds: [],
  };
}

function assertOpen(bag: Bag, verb: string): void {
  if (bag.status !== "open") {
    throw new DomainError(
      "transition_not_allowed",
      `a sealed bag cannot be opened to ${verb} a parcel`,
    );
  }
}

type Handlers = {
  [K in BagEvent["type"]]: (bag: Bag, event: Extract<BagEvent, { type: K }>) => Bag;
};

const HANDLERS: Handlers = {
  parcel_added: (bag, event) => {
    assertOpen(bag, "add");
    if (bag.consignmentIds.includes(event.consignmentId)) return bag;
    return { ...bag, consignmentIds: [...bag.consignmentIds, event.consignmentId] };
  },

  parcel_removed: (bag, event) => {
    assertOpen(bag, "remove");
    return {
      ...bag,
      consignmentIds: bag.consignmentIds.filter((id) => id !== event.consignmentId),
    };
  },

  sealed: (bag, event) => {
    if (bag.status !== "open") {
      throw new DomainError("transition_not_allowed", "that bag is already sealed");
    }
    if (bag.consignmentIds.length === 0) {
      throw new DomainError("invalid_input", "an empty bag cannot be sealed");
    }
    return { ...bag, status: "sealed", sealNumber: event.sealNumber };
  },

  loaded: (bag, event) => {
    if (bag.status === "in_transit") {
      throw new DomainError("transition_not_allowed", "that bag is already on a trip");
    }
    if (bag.status !== "sealed") {
      throw new DomainError("transition_not_allowed", "only a sealed bag can be loaded");
    }
    return { ...bag, status: "in_transit", tripId: event.tripId };
  },

  // A bag at the wrong hub is still a bag somebody is holding. Refusing it would leave it
  // unaccounted for; recording it misrouted puts it on a list somebody works.
  received: (bag, event) => {
    if (bag.status !== "in_transit") {
      throw new DomainError("transition_not_allowed", "only a bag in transit can be received");
    }
    return {
      ...bag,
      status: "received",
      receivedAtHubId: event.hubId,
      sealBroken: !event.sealIntact,
      misrouted: event.hubId !== bag.destinationHubId,
    };
  },

  emptied: (bag, event) => {
    if (bag.status !== "received") {
      throw new DomainError("transition_not_allowed", "only a received bag can be emptied");
    }
    const scanned = new Set(event.scannedIds);
    return {
      ...bag,
      status: "emptied",
      missingIds: bag.consignmentIds.filter((id) => !scanned.has(id)),
      unexpectedIds: event.scannedIds.filter((id) => !bag.consignmentIds.includes(id)),
    };
  },
};

export function apply(bag: Bag, event: BagEvent): Bag {
  const handle = HANDLERS[event.type] as (bag: Bag, event: BagEvent) => Bag;
  return handle(bag, event);
}
