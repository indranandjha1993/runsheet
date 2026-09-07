import { labelFor, type Label, type LabelDestination, type ServiceLevel } from "../domain/label.js";
import { DomainError } from "../domain/errors.js";
import type { OrdersDeps } from "./ports.js";

export interface PrintLabelsCommand {
  readonly tenantId: string;
  readonly consignmentId: string;
  readonly origin: { readonly hubCode: string; readonly city: string };
  readonly destination: LabelDestination;
  readonly sortCode: string;
  readonly serviceLevel: ServiceLevel;
}

// A reprint has to produce the parcel's existing barcodes. Issuing new ones would leave the
// parcel wearing a label the platform no longer recognises.
export async function printLabels(deps: OrdersDeps, command: PrintLabelsCommand): Promise<Label[]> {
  const found = await deps.repository.consignmentById(command.tenantId, command.consignmentId);
  if (found === undefined) {
    throw new DomainError("not_found", "no consignment with that identifier");
  }

  const { consignment } = found;
  const order = await deps.repository.orderById(command.tenantId, consignment.orderId);
  if (order === undefined) {
    throw new DomainError("not_found", "the consignment is not linked to an order");
  }

  const pieces = consignment.packages.length;
  const serial = await deps.repository.serialFor(command.tenantId, consignment.id, pieces);

  return consignment.packages.map((parcel, index) =>
    labelFor({
      consignmentId: consignment.id,
      reference: order.reference,
      serial,
      piece: index + 1,
      pieces,
      origin: command.origin,
      destination: command.destination,
      serviceLevel: command.serviceLevel,
      sortCode: command.sortCode,
      weightGrams: parcel.weightGrams,
      codAmountMinor: consignment.guards.codAmountMinor ?? 0,
      currency: consignment.guards.codCurrency ?? "INR",
    }),
  );
}
