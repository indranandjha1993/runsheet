import type { Envelope } from "@runsheet/kernel";
import type { Bag } from "../domain/bag.js";
import type { Trip } from "../domain/trip.js";
import type {
  Clock,
  EventPublisher,
  Identifiers,
  LinehaulDeps,
  LinehaulRepository,
} from "./ports.js";

const key = (tenantId: string, rest: string): string => `${tenantId}:${rest}`;

function waitingAt(entries: readonly { bag: Bag }[], tenantId: string, hubId: string): Bag[] {
  return entries
    .map((entry) => entry.bag)
    .filter(
      (bag) =>
        bag.tenantId === tenantId &&
        (bag.status === "open" || bag.status === "sealed") &&
        bag.originHubId === hubId,
    );
}

function bagStore(): Pick<
  LinehaulRepository,
  "saveBag" | "bagById" | "bagsOnTrip" | "openBagFor" | "bagsAtHub"
> {
  const bags = new Map<string, { bag: Bag; version: number }>();
  return {
    saveBag: (bag, expectedVersion) => {
      bags.set(key(bag.tenantId, bag.id), { bag, version: expectedVersion + 1 });
      return Promise.resolve();
    },
    bagById: (tenantId, id) => Promise.resolve(bags.get(key(tenantId, id))),
    bagsAtHub: (tenantId, hubId) => Promise.resolve(waitingAt([...bags.values()], tenantId, hubId)),
    bagsOnTrip: (tenantId, tripId) =>
      Promise.resolve(
        [...bags.values()]
          .map((entry) => entry.bag)
          .filter((bag) => bag.tenantId === tenantId && bag.tripId === tripId),
      ),
    openBagFor: (tenantId, originHubId, destinationHubId) =>
      Promise.resolve(
        [...bags.values()]
          .map((entry) => entry.bag)
          .find(
            (bag) =>
              bag.tenantId === tenantId &&
              bag.status === "open" &&
              bag.originHubId === originHubId &&
              bag.destinationHubId === destinationHubId,
          ),
      ),
  };
}

function tripStore(): Pick<LinehaulRepository, "saveTrip" | "tripById" | "openTrips"> {
  const trips = new Map<string, { trip: Trip; version: number }>();
  return {
    saveTrip: (trip, expectedVersion) => {
      trips.set(key(trip.tenantId, trip.id), { trip, version: expectedVersion + 1 });
      return Promise.resolve();
    },
    tripById: (tenantId, id) => Promise.resolve(trips.get(key(tenantId, id))),
    openTrips: (tenantId) =>
      Promise.resolve(
        [...trips.values()]
          .map((entry) => entry.trip)
          .filter(
            (trip) =>
              trip.tenantId === tenantId && trip.status !== "closed" && trip.status !== "cancelled",
          ),
      ),
  };
}

function streamStore(): Pick<LinehaulRepository, "nextSequence"> {
  const sequences = new Map<string, number>();
  return {
    nextSequence: (tenantId, aggregateId) => {
      const at = key(tenantId, aggregateId);
      const next = (sequences.get(at) ?? 0) + 1;
      sequences.set(at, next);
      return Promise.resolve(next);
    },
  };
}

export function inMemoryLinehaul(): LinehaulRepository {
  return { ...bagStore(), ...tripStore(), ...streamStore() };
}

export interface Published {
  event: Envelope;
  payload: Record<string, unknown>;
  topic: string;
}

export function recordingPublisher(): EventPublisher & { published: Published[] } {
  const published: Published[] = [];
  return {
    published,
    publish: (event, payload, topic) => {
      published.push({ event, payload, topic });
      return Promise.resolve();
    },
  };
}

export function fixedClock(at: string): Clock {
  return { now: () => new Date(at) };
}

export function countingIds(): Identifiers {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `01J8Z0T00000000000000${String(n).padStart(5, "0")}`;
    },
  };
}

export function testDeps(): LinehaulDeps & { publisher: ReturnType<typeof recordingPublisher> } {
  return {
    repository: inMemoryLinehaul(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
  };
}
