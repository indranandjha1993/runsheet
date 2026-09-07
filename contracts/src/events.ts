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
const moneyTopic = { topic: "money", key: "aggregate_id" } as const;
const decisionTopic = { topic: "decision", key: "aggregate_id" } as const;

const scannedInPayload = z.object({
  hub_id: z.string(),
  consignment_id: z.string(),
  worker_id: z.string(),
  weight_grams: z.number().int().positive().optional(),
  volumetric_grams: z.number().int().nonnegative().optional(),
});

const scannedOutPayload = z.object({
  hub_id: z.string(),
  consignment_id: z.string(),
  worker_id: z.string(),
  run_id: z.string(),
});

const hubExceptionPayload = z.object({
  hub_id: z.string(),
  consignment_id: z.string(),
  reason: z.enum(["unexpected_parcel", "weight_differs_from_booking", "not_on_this_run"]),
});

const cashMovementPayload = z.object({
  amount_minor: z.number().int().positive(),
  currency: z.string(),
  reference: z.string(),
  driver_id: z.string().optional(),
  merchant_id: z.string().optional(),
});

const cashClosePayload = z.object({
  run_id: z.string(),
  driver_id: z.string(),
  currency: z.string(),
  expectedMinor: z.number().int(),
  countedMinor: z.number().int().nonnegative(),
  varianceMinor: z.number().int(),
  floatAfterMinor: z.number().int(),
});

const cashVariancePayload = z.object({
  run_id: z.string(),
  driver_id: z.string(),
  currency: z.string(),
  variance_minor: z.number().int(),
});

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
  "consignment.scanned_in": define(scannedInPayload, consignmentTopic),
  "consignment.scanned_out": define(scannedOutPayload, consignmentTopic),
  "consignment.hub_exception": define(hubExceptionPayload, consignmentTopic),
  "invoice.received": define(empty, moneyTopic),
  "settlement.approved": define(empty, moneyTopic),
  "settlement.disputed": define(empty, moneyTopic),
  "settlement.dispute_resolved": define(empty, moneyTopic),
  "settlement.dispute_rejected": define(empty, moneyTopic),
  "settlement.paid": define(empty, moneyTopic),
  "settlement.written_off": define(empty, moneyTopic),
  "cash.collected": define(cashMovementPayload, moneyTopic),
  "cash.deposited": define(cashMovementPayload, moneyTopic),
  "cash.remitted": define(cashMovementPayload, moneyTopic),
  "cash.written_off": define(cashMovementPayload, moneyTopic),
  "cash.reversed": define(cashMovementPayload, moneyTopic),
  "cash.run_closed": define(cashClosePayload, moneyTopic),
  "cash.shortfall_found": define(cashVariancePayload, moneyTopic),
  "cash.surplus_found": define(cashVariancePayload, moneyTopic),
  "policy.published": define(empty, decisionTopic),
  "policy.dry_run_passed": define(empty, decisionTopic),
  "policy.shadowed": define(empty, decisionTopic),
  "policy.staged": define(empty, decisionTopic),
  "policy.went_live": define(empty, decisionTopic),
  "policy.rolled_back": define(empty, decisionTopic),
  "policy.retired": define(empty, decisionTopic),
  "decision.proposed": define(empty, decisionTopic),
  "decision.approved": define(empty, decisionTopic),
  "decision.rejected": define(empty, decisionTopic),
  "decision.executed": define(empty, decisionTopic),
  "decision.reversed": define(empty, decisionTopic),
  "decision.failed": define(empty, decisionTopic),
  "decision.expired": define(empty, decisionTopic),
  "decision.shadow_recorded": define(empty, decisionTopic),
  "consignment.out_for_delivery": define(empty, consignmentTopic),
  "consignment.attempted": define(attemptedPayload, consignmentTopic),
  "consignment.delivered": define(empty, consignmentTopic),
  "consignment.rto_initiated": define(empty, consignmentTopic),
  "consignment.rto_out_for_delivery": define(empty, consignmentTopic),
  "consignment.rto_attempted": define(attemptedPayload, consignmentTopic),
  "consignment.rto_delivered": define(empty, consignmentTopic),
  "consignment.cancelled": define(empty, consignmentTopic),
  "consignment.cancel_requested": define(empty, consignmentTopic),
  "consignment.departed_hub": define(empty, consignmentTopic),
  "consignment.damaged": define(empty, consignmentTopic),
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
  "run.unassigned": define(empty, runTopic),
  "run.action_recorded": define(empty, runTopic),
  "run.cash_declared": define(cashPayload, runTopic),
  "run.cash_counted": define(cashPayload, runTopic),
  "run.force_closed": define(empty, runTopic),
  "run.stop_moved": define(empty, runTopic),
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
  "exception.auto_resolved": define(empty, exceptionTopic),
  "exception.triaged": define(empty, exceptionTopic),
  "exception.waiting_on_customer": define(empty, exceptionTopic),
  "exception.customer_answered": define(empty, exceptionTopic),
  "exception.sla_checked": define(empty, exceptionTopic),
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
