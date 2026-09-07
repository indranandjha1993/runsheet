import { z } from "zod";
import { envelopeSchema, ULID } from "./envelope.js";

const money = { minor: z.number().int(), currency: z.string().length(3) };
const empty = z.object({}).loose();

const bookedPayload = z
  .object({
    order_id: ULID,
    service: z.string().min(1),
    payment_mode: z.enum(["prepaid", "cod"]),
    cod_amount_minor: z.number().int().nonnegative().optional(),
    cod_currency: money.currency.optional(),
    guards: z.object({
      proof_requirement: z.string().min(1),
      attempt_limit: z.number().int().positive(),
    }),
  })
  .refine(
    (p) =>
      p.payment_mode !== "cod" ||
      (p.cod_amount_minor !== undefined && p.cod_currency !== undefined),
    {
      message: "cod_amount_minor and cod_currency are required for cash on delivery",
      path: ["cod_currency"],
    },
  );

const attemptedPayload = z.object({
  ndr_reason: z.string().min(1),
  proof_id: ULID,
  attempt_number: z.number().int().positive(),
});

const stopOutcomePayload = z.object({
  run_id: ULID,
  consignment_ids: z.array(ULID).min(1),
  proof_id: ULID.optional(),
  ndr_reason: z.string().min(1).optional(),
});

const cashPayload = z.object({
  run_id: ULID,
  amount_minor: z.number().int(),
  currency: money.currency,
});

const consignmentTopic = { topic: "consignment", key: "aggregate_id" } as const;
const runTopic = { topic: "run", key: "run_id" } as const;
const orderTopic = { topic: "order", key: "aggregate_id" } as const;
const addressTopic = { topic: "address", key: "aggregate_id" } as const;
const networkTopic = { topic: "network", key: "aggregate_id" } as const;
const exceptionTopic = { topic: "exception", key: "subject_aggregate_id" } as const;
const promiseTopic = { topic: "promise", key: "consignment_id" } as const;
const planTopic = { topic: "plan", key: "aggregate_id" } as const;

export interface EventDefinition {
  readonly payload: z.ZodType;
  readonly routing: { readonly topic: string; readonly key: string };
}

function define(payload: z.ZodType, routing: EventDefinition["routing"]): EventDefinition {
  return { payload, routing };
}

export const eventCatalogue: Record<string, EventDefinition> = {
  "hub.created": define(empty, networkTopic),
  "zone.published": define(empty, networkTopic),
  "serviceability.updated": define(empty, networkTopic),
  "address.resolved": define(empty, addressTopic),
  "address.corrected": define(empty, addressTopic),
  "order.created": define(empty, orderTopic),
  "order.cancelled": define(empty, orderTopic),
  "consignment.booked": define(bookedPayload, consignmentTopic),
  "consignment.pickup_attempted": define(attemptedPayload, consignmentTopic),
  "consignment.picked_up": define(empty, consignmentTopic),
  "consignment.inscanned": define(empty, consignmentTopic),
  "consignment.out_for_delivery": define(empty, consignmentTopic),
  "consignment.attempted": define(attemptedPayload, consignmentTopic),
  "consignment.delivered": define(empty, consignmentTopic),
  "consignment.rto_initiated": define(empty, consignmentTopic),
  "consignment.rto_delivered": define(empty, consignmentTopic),
  "consignment.cancelled": define(empty, consignmentTopic),
  "consignment.lost": define(empty, consignmentTopic),
  "consignment.found": define(empty, consignmentTopic),
  "run.planned": define(empty, runTopic),
  "run.assigned": define(empty, runTopic),
  "run.started": define(empty, runTopic),
  "run.suspended": define(empty, runTopic),
  "run.completed": define(empty, runTopic),
  "run.closed": define(empty, runTopic),
  "run.cancelled": define(empty, runTopic),
  "stop.moved": define(empty, runTopic),
  "stop.completed": define(stopOutcomePayload, runTopic),
  "stop.failed": define(stopOutcomePayload, runTopic),
  "stop.skipped": define(stopOutcomePayload, runTopic),
  "proof.captured": define(empty, runTopic),
  "proof.media_uploaded": define(empty, runTopic),
  "cash.collected": define(cashPayload, runTopic),
  "cash.declared": define(cashPayload, runTopic),
  "cash.counted": define(cashPayload, runTopic),
  "device.synced": define(empty, runTopic),
  "plan.requested": define(empty, planTopic),
  "plan.completed": define(empty, planTopic),
  "plan.assignment": define(empty, planTopic),
  "plan.failed": define(empty, planTopic),
  "promise.updated": define(empty, promiseTopic),
  "notification.sent": define(empty, promiseTopic),
  "notification.failed": define(empty, promiseTopic),
  "exception.raised": define(empty, exceptionTopic),
  "exception.assigned": define(empty, exceptionTopic),
  "exception.resolved": define(empty, exceptionTopic),
  "exception.reopened": define(empty, exceptionTopic),
};

export function topicFor(type: string): EventDefinition["routing"] | undefined {
  return eventCatalogue[type]?.routing;
}

export function parseEvent(input: unknown): Envelope & { payload: unknown } {
  const envelope = envelopeSchema.parse(input);
  const definition = eventCatalogue[envelope.type];
  if (definition === undefined) {
    throw new Error(`unknown event type: ${envelope.type}`);
  }
  const payload = definition.payload.parse((input as { payload?: unknown }).payload ?? {});
  return { ...envelope, payload };
}

export type Envelope = z.infer<typeof envelopeSchema>;
