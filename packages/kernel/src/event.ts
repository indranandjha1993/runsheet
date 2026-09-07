import { ulid } from "./ulid.js";

export type EventSource = "api" | "device" | "connector" | "policy" | "operator";

const PROBABILISTIC: readonly EventSource[] = ["device", "connector", "policy"];

export interface Envelope {
  readonly eventId: string;
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly sequence: number;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly source: EventSource;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly confidence?: number;
}

export interface EnvelopeInput {
  readonly tenantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly sequence: number;
  readonly type: string;
  readonly version: number;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly source: EventSource;
  readonly causedBy?: Envelope;
  readonly confidence?: number;
}

function assertTiming(input: EnvelopeInput): void {
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error("sequence must be a positive integer");
  }
  if (input.recordedAt.getTime() < input.occurredAt.getTime()) {
    throw new Error("recordedAt cannot precede occurredAt");
  }
}

function assertConfidence(input: EnvelopeInput): void {
  if (input.confidence === undefined) return;
  if (!PROBABILISTIC.includes(input.source)) {
    throw new Error("confidence is only meaningful for device, connector, or policy sources");
  }
  if (input.confidence < 0 || input.confidence > 1) {
    throw new Error("confidence must be between 0 and 1");
  }
}

export function envelope(input: EnvelopeInput): Envelope {
  assertTiming(input);
  assertConfidence(input);

  const eventId = ulid(input.recordedAt);
  return {
    eventId,
    tenantId: input.tenantId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    sequence: input.sequence,
    type: input.type,
    version: input.version,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    source: input.source,
    correlationId: input.causedBy?.correlationId ?? eventId,
    ...(input.causedBy ? { causationId: input.causedBy.eventId } : {}),
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
  };
}
