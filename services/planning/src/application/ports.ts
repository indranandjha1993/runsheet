import type { Envelope } from "@runsheet/kernel";
import type { Job, Location, Vehicle } from "../domain/capacity.js";

export interface SequenceRequest {
  readonly from: Location;
  readonly jobs: readonly Job[];
}

export interface SequenceResult {
  readonly order: readonly Job[];
  readonly estimatedMinutes: number;
}

// Where a real routing provider goes. Everything above it works the same whichever is plugged in.
export interface RoutePlanner {
  sequence(request: SequenceRequest): Promise<SequenceResult>;
}

export interface PlannedRun {
  readonly id: string;
  readonly tenantId: string;
  readonly hubId: string;
  readonly date: string;
  readonly vehicleId: string;
  readonly stops: readonly { readonly sequence: number; readonly jobId: string }[];
  readonly estimatedMinutes: number;
}

export interface PlanningRepository {
  savePlan(runs: readonly PlannedRun[], tenantId: string, hubId: string, date: string): Promise<void>;
  planFor(tenantId: string, hubId: string, date: string): Promise<PlannedRun[]>;
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

export interface PlanningDeps {
  readonly repository: PlanningRepository;
  readonly planner: RoutePlanner;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  readonly ids: Identifiers;
}

export type { Job, Location, Vehicle };
