import type { Envelope } from "@runsheet/kernel";
import type { Run } from "../domain/run.js";
import type { Proof } from "../domain/proof.js";

export interface ExecutionRepository {
  saveRun(run: Run, expectedVersion: number): Promise<void>;
  runById(tenantId: string, id: string): Promise<{ run: Run; version: number } | undefined>;
  openRuns(tenantId: string, hubId: string, date: string): Promise<Run[]>;
  saveProof(proof: Proof): Promise<void>;
  proofById(tenantId: string, id: string): Promise<Proof | undefined>;
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

export interface ExecutionDeps {
  readonly repository: ExecutionRepository;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  readonly ids: Identifiers;
}
