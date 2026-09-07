import { DomainError } from "./errors.js";

export type TripStatus = "planned" | "crewed" | "departed" | "arrived" | "closed" | "cancelled";

export interface Trip {
  readonly id: string;
  readonly tenantId: string;
  readonly originHubId: string;
  readonly destinationHubId: string;
  readonly departsOn: string;
  readonly capacityBags: number;
  readonly status: TripStatus;
  readonly bagIds: readonly string[];
  readonly vehicleId?: string;
  readonly driverId?: string;
  readonly arrivedAtHubId?: string;
  readonly divertedTo?: string;
  readonly missingBagIds: readonly string[];
  readonly cancelReason?: string;
}

export interface PlanTripCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly originHubId: string;
  readonly destinationHubId: string;
  readonly departsOn: string;
  readonly capacityBags: number;
}

export type TripEvent =
  | { type: "crewed"; vehicleId: string; driverId: string }
  | { type: "bag_loaded"; bagId: string }
  | { type: "bag_unloaded"; bagId: string }
  | { type: "departed" }
  | { type: "arrived"; hubId: string }
  | { type: "closed"; receivedBagIds: readonly string[] }
  | { type: "cancelled"; reason: string };

export function planTrip(command: PlanTripCommand): Trip {
  if (command.originHubId === command.destinationHubId) {
    throw new DomainError("invalid_input", "a trip cannot end where it started");
  }
  if (command.capacityBags < 1) {
    throw new DomainError("invalid_input", "a trip must have room for at least one bag");
  }

  return { ...command, status: "planned", bagIds: [], missingBagIds: [] };
}

const LOADABLE: readonly TripStatus[] = ["crewed"];

function assertLoadable(trip: Trip): void {
  if (trip.status === "departed" || trip.status === "arrived" || trip.status === "closed") {
    throw new DomainError("transition_not_allowed", "a trip that has left cannot be loaded");
  }
  if (!LOADABLE.includes(trip.status)) {
    throw new DomainError(
      "transition_not_allowed",
      "a trip needs a vehicle and a driver before it is loaded",
    );
  }
}

type Handlers = {
  [K in TripEvent["type"]]: (trip: Trip, event: Extract<TripEvent, { type: K }>) => Trip;
};

const HANDLERS: Handlers = {
  crewed: (trip, event) => {
    if (trip.status !== "planned" && trip.status !== "crewed") {
      throw new DomainError("transition_not_allowed", "a trip on the road cannot be re-crewed");
    }
    return { ...trip, status: "crewed", vehicleId: event.vehicleId, driverId: event.driverId };
  },

  bag_loaded: (trip, event) => {
    assertLoadable(trip);
    if (trip.bagIds.includes(event.bagId)) return trip;
    if (trip.bagIds.length >= trip.capacityBags) {
      throw new DomainError("invalid_input", "that trip has no room for another bag");
    }
    return { ...trip, bagIds: [...trip.bagIds, event.bagId] };
  },

  bag_unloaded: (trip, event) => {
    assertLoadable(trip);
    return { ...trip, bagIds: trip.bagIds.filter((id) => id !== event.bagId) };
  },

  departed: (trip) => {
    if (trip.status !== "crewed") {
      throw new DomainError("transition_not_allowed", "only a crewed trip can depart");
    }
    if (trip.bagIds.length === 0) {
      throw new DomainError("invalid_input", "an empty trip cannot depart");
    }
    return { ...trip, status: "departed" };
  },

  // A diversion is recorded rather than refused. The vehicle is where it is, and the bags on it
  // have to be findable from the record, not from a phone call.
  arrived: (trip, event) => {
    if (trip.status !== "departed") {
      throw new DomainError("transition_not_allowed", "only a trip on the road can arrive");
    }
    return {
      ...trip,
      status: "arrived",
      arrivedAtHubId: event.hubId,
      ...(event.hubId === trip.destinationHubId ? {} : { divertedTo: event.hubId }),
    };
  },

  closed: (trip, event) => {
    if (trip.status !== "arrived") {
      throw new DomainError("transition_not_allowed", "only a trip that has arrived can be closed");
    }
    const received = new Set(event.receivedBagIds);
    return {
      ...trip,
      status: "closed",
      missingBagIds: trip.bagIds.filter((id) => !received.has(id)),
    };
  },

  cancelled: (trip, event) => {
    if (trip.status !== "planned" && trip.status !== "crewed") {
      throw new DomainError("transition_not_allowed", "a trip that has left cannot be cancelled");
    }
    return { ...trip, status: "cancelled", cancelReason: event.reason };
  },
};

export function apply(trip: Trip, event: TripEvent): Trip {
  const handle = HANDLERS[event.type] as (trip: Trip, event: TripEvent) => Trip;
  return handle(trip, event);
}
