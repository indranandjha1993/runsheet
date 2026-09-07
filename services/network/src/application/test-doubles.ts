import type { Envelope } from "@runsheet/kernel";
import type { Clock, EventPublisher, Identifiers, NetworkRepository } from "./ports.js";
import type { Hub } from "../domain/hub.js";
import type { Zone } from "../domain/zone.js";
import type { Lane } from "../domain/lane.js";

export function inMemoryNetwork(): NetworkRepository {
  const hubs = new Map<string, Hub>();
  const zones = new Map<string, Zone[]>();
  const lanes = new Map<string, Lane[]>();
  const sequences = new Map<string, number>();
  const key = (tenantId: string, rest: string): string => `${tenantId}:${rest}`;

  return {
    saveHub: (value) => {
      hubs.set(key(value.tenantId, value.code), value);
      return Promise.resolve();
    },
    hubByCode: (tenantId, code) => Promise.resolve(hubs.get(key(tenantId, code))),
    hubById: (tenantId, id) =>
      Promise.resolve([...hubs.values()].find((h) => h.tenantId === tenantId && h.id === id)),
    saveZone: (tenantId, zone) => {
      zones.set(tenantId, [...(zones.get(tenantId) ?? []), zone]);
      return Promise.resolve();
    },
    zonesFor: (tenantId) => Promise.resolve(zones.get(tenantId) ?? []),
    saveLane: (tenantId, lane) => {
      lanes.set(tenantId, [...(lanes.get(tenantId) ?? []), lane]);
      return Promise.resolve();
    },
    lanesFrom: (tenantId, originHubId) =>
      Promise.resolve((lanes.get(tenantId) ?? []).filter((l) => l.originHubId === originHubId)),
    nextSequence: (tenantId, aggregateId) => {
      const at = key(tenantId, aggregateId);
      const next = (sequences.get(at) ?? 0) + 1;
      sequences.set(at, next);
      return Promise.resolve(next);
    },
  };
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
