import type { Envelope } from "@runsheet/kernel";
import type { Consignment } from "../domain/consignment.js";
import type { Clock, EventPublisher, Identifiers, Order, OrdersRepository } from "./ports.js";

/* eslint-disable max-lines-per-function -- one cohesive fake of a repository interface */
export function inMemoryOrders(): OrdersRepository {
  const orders = new Map<string, Order>();
  const consignments = new Map<string, { consignment: Consignment; version: number }>();
  const sequences = new Map<string, number>();
  const serials = new Map<string, number>();
  let nextSerial = 1;
  const key = (tenantId: string, rest: string): string => `${tenantId}:${rest}`;

  return {
    saveOrder: (order) => {
      orders.set(key(order.tenantId, order.reference), order);
      return Promise.resolve();
    },
    orderByReference: (tenantId, reference) =>
      Promise.resolve(orders.get(key(tenantId, reference))),
    orderById: (tenantId, id) =>
      Promise.resolve(
        [...orders.values()].find((order) => order.tenantId === tenantId && order.id === id),
      ),
    saveConsignment: (consignment, expectedVersion) => {
      consignments.set(key(consignment.tenantId, consignment.id), {
        consignment,
        version: expectedVersion + 1,
      });
      return Promise.resolve();
    },
    consignmentById: (tenantId, id) => Promise.resolve(consignments.get(key(tenantId, id))),
    openConsignments: (tenantId, limit) =>
      Promise.resolve(
        [...consignments.values()]
          .map((entry) => entry.consignment)
          .filter((c) => c.tenantId === tenantId)
          .slice(0, limit),
      ),
    serialFor: (tenantId, consignmentId, pieces) => {
      const at = `${tenantId}:${consignmentId}`;
      const existing = serials.get(at);
      if (existing !== undefined) return Promise.resolve(existing);
      const first = nextSerial;
      nextSerial += pieces;
      serials.set(at, first);
      return Promise.resolve(first);
    },
    nextSequence: (tenantId, aggregateId) => {
      const at = key(tenantId, aggregateId);
      const next = (sequences.get(at) ?? 0) + 1;
      sequences.set(at, next);
      return Promise.resolve(next);
    },
  };
}
/* eslint-enable max-lines-per-function */

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
