import { DomainError } from "./errors.js";

export interface WeightBand {
  readonly upToGrams: number;
  readonly priceMinor: number;
}

export interface Surcharge {
  readonly code: string;
  readonly percent: number;
}

export interface Lane {
  readonly origin: string;
  readonly destination: string;
  readonly service: string;
  readonly bands: readonly WeightBand[];
  readonly surcharges: readonly Surcharge[];
}

export interface RateCardInput {
  readonly id: string;
  readonly tenantId: string;
  readonly carrierAccountId: string;
  readonly currency: string;
  readonly validFrom: Date;
  readonly validUntil?: Date;
  readonly lanes: readonly Lane[];
}

export type RateCard = RateCardInput;

export interface Shipment {
  readonly origin: string;
  readonly destination: string;
  readonly service: string;
  readonly weightGrams: number;
  readonly at: Date;
}

export interface Price {
  readonly currency: string;
  readonly baseMinor: number;
  readonly surcharges: readonly { readonly code: string; readonly amountMinor: number }[];
  readonly totalMinor: number;
}

function assertLane(lane: Lane): void {
  let previous = 0;
  for (const band of lane.bands) {
    if (band.upToGrams <= previous) {
      throw new DomainError("invalid_input", "weight bands must be in ascending order");
    }
    previous = band.upToGrams;
  }
  for (const surcharge of lane.surcharges) {
    if (surcharge.percent < 0 || surcharge.percent > 100) {
      throw new DomainError("invalid_input", "a surcharge must be between 0 and 100 percent");
    }
  }
}

export function rateCard(input: RateCardInput): RateCard {
  if (input.lanes.length === 0) {
    throw new DomainError("invalid_input", "a rate card needs at least one lane");
  }
  for (const lane of input.lanes) assertLane(lane);
  return input;
}

function inForce(card: RateCard, at: Date): boolean {
  if (at < card.validFrom) return false;
  return card.validUntil === undefined || at <= card.validUntil;
}

// Nothing above the heaviest band is priced. Guessing a price for an unpriced weight is how a
// carrier ends up billing whatever they like and the match agreeing with them.
export function priceFor(card: RateCard, shipment: Shipment): Price | undefined {
  if (!inForce(card, shipment.at)) return undefined;

  const lane = card.lanes.find(
    (candidate) =>
      candidate.origin === shipment.origin &&
      candidate.destination === shipment.destination &&
      candidate.service === shipment.service,
  );
  if (lane === undefined) return undefined;

  const band = lane.bands.find((candidate) => shipment.weightGrams <= candidate.upToGrams);
  if (band === undefined) return undefined;

  const surcharges = lane.surcharges.map((surcharge) => ({
    code: surcharge.code,
    amountMinor: Math.round((band.priceMinor * surcharge.percent) / 100),
  }));

  return {
    currency: card.currency,
    baseMinor: band.priceMinor,
    surcharges,
    totalMinor: surcharges.reduce((total, s) => total + s.amountMinor, band.priceMinor),
  };
}
