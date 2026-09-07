import type { Envelope } from "@runsheet/kernel";
import type { Promise as DeliveryPromise } from "../domain/promise.js";
import type {
  Clock,
  EventPublisher,
  Identifiers,
  Messenger,
  Notification,
  PromiseRepository,
} from "./ports.js";

export function inMemoryPromises(): PromiseRepository {
  const promises = new Map<string, DeliveryPromise>();
  const notifications: Notification[] = [];
  const sequences = new Map<string, number>();
  const key = (tenantId: string, rest: string): string => `${tenantId}:${rest}`;

  return {
    save: (promise) => {
      promises.set(key(promise.tenantId, promise.consignmentId), promise);
      return Promise.resolve();
    },
    byConsignment: (tenantId, consignmentId) =>
      Promise.resolve(promises.get(key(tenantId, consignmentId))),
    recordNotification: (notification) => {
      notifications.push(notification);
      return Promise.resolve();
    },
    notificationsFor: (tenantId, consignmentId) =>
      Promise.resolve(
        notifications.filter((n) => n.tenantId === tenantId && n.consignmentId === consignmentId),
      ),
    nextSequence: (tenantId, aggregateId) => {
      const at = key(tenantId, aggregateId);
      const next = (sequences.get(at) ?? 0) + 1;
      sequences.set(at, next);
      return Promise.resolve(next);
    },
  };
}

export function recordingMessenger(): Messenger & { sent: { text: string; locale: string }[] } {
  const sent: { text: string; locale: string }[] = [];
  return {
    sent,
    send: (to) => {
      sent.push({ text: to.text, locale: to.locale });
      return Promise.resolve();
    },
  };
}

export function failingMessenger(reason = "provider unreachable"): Messenger {
  return { send: () => Promise.reject(new Error(reason)) };
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
