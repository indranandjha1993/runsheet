import { apply, planTrip, type Trip, type TripEvent } from "../domain/trip.js";
import { apply as applyToBag, type Bag } from "../domain/bag.js";
import { manifestFor, type Manifest } from "../domain/manifest.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import { loadBagOrFail } from "./bag-operations.js";
import type { LinehaulDeps } from "./ports.js";

async function announceTrip(
  deps: LinehaulDeps,
  trip: Trip,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await announce(deps, {
    tenantId: trip.tenantId,
    aggregateType: "trip",
    aggregateId: trip.id,
    type,
    topic: "linehaul",
    payload,
  });
}

async function tripOrFail(
  deps: LinehaulDeps,
  tenantId: string,
  tripId: string,
): Promise<{ trip: Trip; version: number }> {
  const found = await deps.repository.tripById(tenantId, tripId);
  if (found === undefined) throw new DomainError("not_found", "no trip with that identifier");
  return found;
}

export interface PlanTripCommand {
  readonly tenantId: string;
  readonly originHubId: string;
  readonly destinationHubId: string;
  readonly departsOn: string;
  readonly capacityBags: number;
}

export async function planTripFor(deps: LinehaulDeps, command: PlanTripCommand): Promise<Trip> {
  const trip = planTrip({ id: deps.ids.next(), ...command });
  await deps.repository.saveTrip(trip, 0);
  await announceTrip(deps, trip, "trip.planned", {
    origin_hub_id: trip.originHubId,
    destination_hub_id: trip.destinationHubId,
    departs_on: trip.departsOn,
  });
  return trip;
}

export interface RecordTripEventCommand {
  readonly tenantId: string;
  readonly tripId: string;
  readonly event: TripEvent;
}

export async function recordTripEvent(
  deps: LinehaulDeps,
  command: RecordTripEventCommand,
): Promise<Trip> {
  const found = await tripOrFail(deps, command.tenantId, command.tripId);
  const trip = apply(found.trip, command.event);
  await deps.repository.saveTrip(trip, found.version);

  await announceTrip(deps, trip, `trip.${command.event.type}`, {
    status: trip.status,
    bag_count: trip.bagIds.length,
  });

  if (command.event.type === "closed" && trip.missingBagIds.length > 0) {
    await announceTrip(deps, trip, "trip.bags_missing", { bag_ids: trip.missingBagIds });
  }
  return trip;
}

export interface LoadBagCommand {
  readonly tenantId: string;
  readonly tripId: string;
  readonly bagId: string;
}

// The bag moves first. If the bag refuses, the trip is never told it is carrying something it
// is not, which is the failure that loses parcels.
export async function loadBag(
  deps: LinehaulDeps,
  command: LoadBagCommand,
): Promise<{ trip: Trip; bag: Bag }> {
  const foundTrip = await tripOrFail(deps, command.tenantId, command.tripId);
  const foundBag = await loadBagOrFail(deps, command.tenantId, command.bagId);

  const bag = applyToBag(foundBag.bag, { type: "loaded", tripId: command.tripId });
  const trip = apply(foundTrip.trip, { type: "bag_loaded", bagId: command.bagId });

  await deps.repository.saveBag(bag, foundBag.version);
  await deps.repository.saveTrip(trip, foundTrip.version);

  await announceTrip(deps, trip, "trip.bag_loaded", {
    bag_id: bag.id,
    seal_number: bag.sealNumber ?? "unsealed",
    parcel_count: bag.consignmentIds.length,
  });

  // The bag changed state too. A consumer following a parcel watches the bag, not the trip.
  await announce(deps, {
    tenantId: bag.tenantId,
    aggregateType: "bag",
    aggregateId: bag.id,
    type: "bag.loaded",
    topic: "linehaul",
    payload: { bag_id: bag.id, trip_id: trip.id, status: bag.status },
  });

  return { trip, bag };
}

export async function manifestOf(
  deps: LinehaulDeps,
  tenantId: string,
  tripId: string,
): Promise<Manifest> {
  const { trip } = await tripOrFail(deps, tenantId, tripId);
  const bags = await deps.repository.bagsOnTrip(tenantId, tripId);
  return manifestFor(trip, bags);
}
