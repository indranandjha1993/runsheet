import type { Envelope } from "@runsheet/kernel";
import type { Exception, Severity } from "../domain/exception.js";

export interface ExceptionsRepository {
  save(exception: Exception): Promise<void>;
  byId(tenantId: string, id: string): Promise<Exception | undefined>;
  openFor(tenantId: string, type: string, subjectId: string): Promise<Exception | undefined>;
  queue(tenantId: string, severity?: Severity): Promise<Exception[]>;
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

export interface ExceptionsDeps {
  readonly repository: ExceptionsRepository;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  readonly ids: Identifiers;
}
