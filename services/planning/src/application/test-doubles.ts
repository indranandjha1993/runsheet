import type { Envelope } from "@runsheet/kernel";
import type {
  Clock,
  EventPublisher,
  Identifiers,
  PlannedRun,
  PlanningRepository,
} from "./ports.js";

export function inMemoryPlans(): PlanningRepository {
  const plans = new Map<string, PlannedRun[]>();
  const sequences = new Map<string, number>();
  const key = (tenantId: string, hubId: string, date: string): string =>
    `${tenantId}:${hubId}:${date}`;

  return {
    savePlan: (runs, tenantId, hubId, date) => {
      plans.set(key(tenantId, hubId, date), [...runs]);
      return Promise.resolve();
    },
    planFor: (tenantId, hubId, date) =>
      Promise.resolve(plans.get(key(tenantId, hubId, date)) ?? []),
    nextSequence: (tenantId, aggregateId) => {
      const at = `${tenantId}:${aggregateId}`;
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
