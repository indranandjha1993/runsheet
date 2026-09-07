import type { Envelope } from "@runsheet/kernel";
import type { Exception } from "../domain/exception.js";
import type { Clock, EventPublisher, ExceptionsRepository, Identifiers } from "./ports.js";

export function inMemoryExceptions(): ExceptionsRepository {
  const byId = new Map<string, Exception>();
  const sequences = new Map<string, number>();
  const key = (tenantId: string, rest: string): string => `${tenantId}:${rest}`;

  return {
    save: (exception) => {
      byId.set(key(exception.tenantId, exception.id), exception);
      return Promise.resolve();
    },
    byId: (tenantId, id) => Promise.resolve(byId.get(key(tenantId, id))),
    openFor: (tenantId, type, subjectId) =>
      Promise.resolve(
        [...byId.values()].find(
          (exception) =>
            exception.tenantId === tenantId &&
            exception.type === type &&
            exception.subjectId === subjectId &&
            exception.state !== "resolved",
        ),
      ),
    queue: (tenantId, severity) =>
      Promise.resolve(
        [...byId.values()].filter(
          (exception) =>
            exception.tenantId === tenantId &&
            exception.state !== "resolved" &&
            (severity === undefined || exception.severity === severity),
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
