import type { Envelope } from "@runsheet/kernel";
import type { Bag } from "../domain/bag.js";
import type { Trip } from "../domain/trip.js";

export interface LinehaulRepository {
  saveBag(bag: Bag, expectedVersion: number): Promise<void>;
  bagById(tenantId: string, id: string): Promise<{ bag: Bag; version: number } | undefined>;
  bagsOnTrip(tenantId: string, tripId: string): Promise<Bag[]>;
  openBagFor(
    tenantId: string,
    originHubId: string,
    destinationHubId: string,
  ): Promise<Bag | undefined>;
  bagsAtHub(tenantId: string, hubId: string): Promise<Bag[]>;
  saveTrip(trip: Trip, expectedVersion: number): Promise<void>;
  tripById(tenantId: string, id: string): Promise<{ trip: Trip; version: number } | undefined>;
  openTrips(tenantId: string): Promise<Trip[]>;
  nextSequence(tenantId: string, aggregateId: string): Promise<number>;
}

export interface EventPublisher {
  publish(event: Envelope, payload: Record<string, unknown>, topic: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Identifiers {
  next(): string;
}

export interface LinehaulDeps {
  readonly repository: LinehaulRepository;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  readonly ids: Identifiers;
}
