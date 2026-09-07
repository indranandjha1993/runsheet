import { barcodeFor, money } from "@runsheet/kernel";
import { DomainError } from "./errors.js";

export { barcodeFor, isValidBarcode } from "@runsheet/kernel";

export type ServiceLevel = "same_day" | "next_day" | "standard" | "economy";

export interface LabelDestination {
  readonly hubCode: string;
  readonly name: string;
  readonly line: string;
  readonly locality?: string | undefined;
  readonly city: string;
  readonly postcode: string;
}

export interface LabelRequest {
  readonly consignmentId: string;
  readonly reference: string;
  readonly serial: number;
  readonly piece: number;
  readonly pieces: number;
  readonly origin: { readonly hubCode: string; readonly city: string };
  readonly destination: LabelDestination;
  readonly serviceLevel: ServiceLevel;
  readonly sortCode: string;
  readonly weightGrams: number;
  readonly codAmountMinor: number;
  readonly currency: string;
}

export interface Label {
  readonly barcode: string;
  readonly reference: string;
  readonly origin: string;
  readonly destinationHubCode: string;
  readonly sortCode: string;
  readonly serviceLevel: ServiceLevel;
  readonly address: readonly string[];
  readonly weight: string;
  readonly pieceOf?: string | undefined;
  readonly cod?: string | undefined;
}

function addressLines(destination: LabelDestination): string[] {
  return [
    destination.name,
    destination.line,
    destination.locality ?? "",
    `${destination.city} ${destination.postcode}`.trim(),
  ].filter((line) => line.trim() !== "");
}

// Every piece of a consignment carries its own barcode, taken from a block of serials the
// allocator reserved for it. A shared barcode would make two parcels indistinguishable at a hub.
function serialForPiece(request: LabelRequest): number {
  if (request.piece < 1 || request.piece > request.pieces) {
    throw new DomainError(
      "invalid_input",
      `piece ${String(request.piece)} of ${String(request.pieces)} is not a parcel`,
    );
  }
  return request.serial + request.piece - 1;
}

export function labelFor(request: LabelRequest): Label {
  const barcode = barcodeFor(serialForPiece(request));
  const cod =
    request.codAmountMinor > 0
      ? money(request.codAmountMinor, request.currency).toString()
      : undefined;

  return {
    barcode,
    reference: request.reference,
    origin: `${request.origin.hubCode} ${request.origin.city}`,
    destinationHubCode: request.destination.hubCode,
    sortCode: request.sortCode,
    serviceLevel: request.serviceLevel,
    address: addressLines(request.destination),
    weight: `${(request.weightGrams / 1000).toFixed(2)} kg`,
    ...(request.pieces > 1
      ? { pieceOf: `${String(request.piece)} of ${String(request.pieces)}` }
      : {}),
    ...(cod === undefined ? {} : { cod }),
  };
}
