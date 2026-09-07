import { apply, type Consignment, type ConsignmentEvent } from "../domain/consignment.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import type { OrdersDeps } from "./ports.js";

export interface RecordEventCommand {
  readonly tenantId: string;
  readonly consignmentId: string;
  readonly event: ConsignmentEvent;
}

// Each builder receives its own event variant, so none has to narrow.
type PayloadBuilders = {
  [K in ConsignmentEvent["type"]]?: (
    event: Extract<ConsignmentEvent, { type: K }>,
  ) => Record<string, unknown>;
};

const reasoned = (e: { ndrReason: string; proofId: string }): Record<string, unknown> => ({
  ndr_reason: e.ndrReason,
  proof_id: e.proofId,
});

const PAYLOAD: PayloadBuilders = {
  attempted: reasoned,
  pickup_attempted: reasoned,
  rto_attempted: reasoned,
  delivered: (e) => ({ proof_id: e.proofId }),
  rto_delivered: (e) => ({ proof_id: e.proofId }),
  inscanned: (e) => ({ hub_id: e.hubId }),
  found: (e) => ({ hub_id: e.hubId }),
  out_for_delivery: (e) => ({ run_id: e.runId }),
  rto_out_for_delivery: (e) => ({ run_id: e.runId }),
};

function payloadFor(event: ConsignmentEvent): Record<string, unknown> {
  const build = PAYLOAD[event.type] as
    ((e: ConsignmentEvent) => Record<string, unknown>) | undefined;
  return build?.(event) ?? {};
}

export async function recordConsignmentEvent(
  deps: OrdersDeps,
  command: RecordEventCommand,
): Promise<Consignment> {
  const found = await deps.repository.consignmentById(command.tenantId, command.consignmentId);
  if (found === undefined) {
    throw new DomainError("not_found", "no consignment with that identifier");
  }

  const next = apply(found.consignment, command.event);
  await deps.repository.saveConsignment(next, found.version);

  await announce(deps, {
    tenantId: next.tenantId,
    aggregateType: "consignment",
    aggregateId: next.id,
    type: `consignment.${command.event.type}`,
    topic: "consignment",
    payload: { status: next.status, ...payloadFor(command.event) },
  });

  return next;
}
