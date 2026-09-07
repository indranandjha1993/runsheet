import type { Envelope } from "@runsheet/kernel";
import type { Promise as DeliveryPromise } from "../domain/promise.js";

export interface Notification {
  readonly id: string;
  readonly tenantId: string;
  readonly consignmentId: string;
  readonly channel: string;
  readonly template: string;
  readonly locale: string;
  readonly sentAt?: Date;
  readonly failedReason?: string;
}

export interface PromiseRepository {
  save(promise: DeliveryPromise): Promise<void>;
  byConsignment(tenantId: string, consignmentId: string): Promise<DeliveryPromise | undefined>;
  recordNotification(notification: Notification): Promise<void>;
  notificationsFor(tenantId: string, consignmentId: string): Promise<Notification[]>;
  nextSequence(tenantId: string, aggregateId: string): Promise<number>;
}

export interface Messenger {
  send(to: { channel: string; text: string; locale: string }): Promise<void>;
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

export interface PromiseDeps {
  readonly repository: PromiseRepository;
  readonly messenger: Messenger;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  readonly ids: Identifiers;
  readonly signingSecret: string;
  readonly trackingValidHours: number;
}
