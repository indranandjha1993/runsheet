import type { Envelope } from "@runsheet/kernel";
import type { Consignment } from "../domain/consignment.js";

export interface Order {
  readonly id: string;
  readonly tenantId: string;
  readonly reference: string;
  readonly paymentMode: "prepaid" | "cod";
}

export interface OrdersRepository {
  saveOrder(order: Order): Promise<void>;
  orderByReference(tenantId: string, reference: string): Promise<Order | undefined>;
  saveConsignment(consignment: Consignment, expectedVersion: number): Promise<void>;
  consignmentById(tenantId: string, id: string): Promise<{ consignment: Consignment; version: number } | undefined>;
  openConsignments(tenantId: string, limit: number): Promise<Consignment[]>;
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

export interface OrdersDeps {
  readonly repository: OrdersRepository;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  readonly ids: Identifiers;
}
