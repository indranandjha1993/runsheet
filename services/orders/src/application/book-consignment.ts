import { book, type Consignment, type Guards } from "../domain/consignment.js";
import { announce } from "./announce.js";
import type { Order, OrdersDeps } from "./ports.js";

export interface BookConsignmentCommand {
  readonly tenantId: string;
  readonly orderReference: string;
  readonly service: string;
  readonly paymentMode: "prepaid" | "cod";
  readonly proofRequirement: string;
  readonly attemptLimit: number;
  readonly codAmountMinor?: number;
  readonly codCurrency?: string;
  readonly codToleranceMinor?: number;
  readonly packages: readonly { readonly weightGrams: number }[];
}

function guardsFrom(command: BookConsignmentCommand): Guards {
  return {
    proofRequirement: command.proofRequirement,
    attemptLimit: command.attemptLimit,
    ...(command.codAmountMinor === undefined ? {} : { codAmountMinor: command.codAmountMinor }),
    ...(command.codCurrency === undefined ? {} : { codCurrency: command.codCurrency }),
    ...(command.codToleranceMinor === undefined
      ? {}
      : { codToleranceMinor: command.codToleranceMinor }),
  };
}

async function orderFor(deps: OrdersDeps, command: BookConsignmentCommand): Promise<Order> {
  const existing = await deps.repository.orderByReference(command.tenantId, command.orderReference);
  if (existing !== undefined) return existing;

  const order: Order = {
    id: deps.ids.next(),
    tenantId: command.tenantId,
    reference: command.orderReference,
    paymentMode: command.paymentMode,
  };
  await deps.repository.saveOrder(order);
  await announce(deps, {
    tenantId: order.tenantId,
    aggregateType: "order",
    aggregateId: order.id,
    type: "order.created",
    topic: "order",
    payload: { reference: order.reference, payment_mode: order.paymentMode },
  });
  return order;
}

export async function bookConsignment(
  deps: OrdersDeps,
  command: BookConsignmentCommand,
): Promise<Consignment> {
  const consignment = book({
    id: deps.ids.next(),
    tenantId: command.tenantId,
    orderId: "pending",
    service: command.service,
    paymentMode: command.paymentMode,
    guards: guardsFrom(command),
    packages: command.packages.map((p) => ({ id: deps.ids.next(), weightGrams: p.weightGrams })),
  });

  const order = await orderFor(deps, command);
  const linked = { ...consignment, orderId: order.id };
  await deps.repository.saveConsignment(linked, 0);

  await announce(deps, {
    tenantId: linked.tenantId,
    aggregateType: "consignment",
    aggregateId: linked.id,
    type: "consignment.booked",
    topic: "consignment",
    payload: {
      order_id: order.id,
      service: linked.service,
      payment_mode: linked.paymentMode,
      ...(linked.guards.codAmountMinor === undefined
        ? {}
        : { cod_amount_minor: linked.guards.codAmountMinor }),
      ...(linked.guards.codCurrency === undefined
        ? {}
        : { cod_currency: linked.guards.codCurrency }),
      guards: {
        proof_requirement: linked.guards.proofRequirement,
        attempt_limit: linked.guards.attemptLimit,
      },
    },
  });

  return linked;
}
