import type { Envelope } from "@runsheet/kernel";
import type { Address } from "../domain/address.js";
import type {
  AddressRepository,
  Clock,
  EventPublisher,
  Geocoder,
  Identifiers,
} from "./ports.js";

export function inMemoryAddresses(): AddressRepository {
  const byId = new Map<string, Address>();
  const sequences = new Map<string, number>();
  const key = (tenantId: string, rest: string): string => `${tenantId}:${rest}`;

  return {
    save: (address) => {
      byId.set(key(address.tenantId, address.id), address);
      return Promise.resolve();
    },
    byId: (tenantId, id) => Promise.resolve(byId.get(key(tenantId, id))),
    byText: (tenantId, raw) =>
      Promise.resolve(
        [...byId.values()].find(
          (address) => address.tenantId === tenantId && address.parsed.raw === raw,
        ),
      ),
    nextSequence: (tenantId, aggregateId) => {
      const at = key(tenantId, aggregateId);
      const next = (sequences.get(at) ?? 0) + 1;
      sequences.set(at, next);
      return Promise.resolve(next);
    },
  };
}

export function fixedGeocoder(confidence = 0.6): Geocoder {
  return {
    locate: () => Promise.resolve({ latitude: 12.97, longitude: 77.64, confidence }),
  };
}

export function silentGeocoder(): Geocoder {
  return { locate: () => Promise.resolve(undefined) };
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
