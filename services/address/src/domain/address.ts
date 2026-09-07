import { DomainError } from "./errors.js";
import { parseAddress, type ParsedAddress } from "./parse.js";

// Two pins more than this far apart are not the same door. Roughly 150 metres.
const SAME_DOOR_DEGREES = 0.0015;

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

export interface Address {
  readonly id: string;
  readonly tenantId: string;
  readonly parsed: ParsedAddress;
  readonly location?: Coordinates;
  readonly source: "none" | "geocoder" | "driver";
  readonly confidence: number;
  readonly confirmations: number;
  readonly lastConfirmedBy?: string;
  readonly lastConfirmedAt?: Date;
  readonly resolvedAt: Date;
}

export interface ResolveCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly raw: string;
  readonly countryCode: string;
  readonly geocoded?: Coordinates & { readonly confidence: number };
  readonly at: Date;
}

export interface ConfirmPinCommand extends Coordinates {
  readonly workerId: string;
  readonly at: Date;
}

function assertCoordinates(at: Coordinates): void {
  if (at.latitude < -90 || at.latitude > 90) {
    throw new DomainError("invalid_input", "latitude must be between -90 and 90");
  }
  if (at.longitude < -180 || at.longitude > 180) {
    throw new DomainError("invalid_input", "longitude must be between -180 and 180");
  }
}

// A guessed pin can never be trusted as much as one a person stood on. Everything a geocoder
// produces sits below this line; everything a driver confirms sits above it.
const FIELD_EVIDENCE_FLOOR = 0.85;

// How much we trust a geocoded pin. Text quality counts as much as the geocoder's own score,
// because a geocoder confidently placing a vague line is confidently wrong.
function confidenceOf(parsed: ParsedAddress, geocoderScore: number | undefined): number {
  if (geocoderScore === undefined) return parsed.completeness * 0.4;
  return (geocoderScore * 0.6 + parsed.completeness * 0.4) * FIELD_EVIDENCE_FLOOR;
}

export function resolveAddress(command: ResolveCommand): Address {
  const parsed = parseAddress(command.raw, command.countryCode);
  if (command.geocoded !== undefined) assertCoordinates(command.geocoded);

  return {
    id: command.id,
    tenantId: command.tenantId,
    parsed,
    source: command.geocoded === undefined ? "none" : "geocoder",
    confidence: confidenceOf(parsed, command.geocoded?.confidence),
    confirmations: 0,
    resolvedAt: command.at,
    ...(command.geocoded === undefined
      ? {}
      : {
          location: {
            latitude: command.geocoded.latitude,
            longitude: command.geocoded.longitude,
          },
        }),
  };
}

function nearby(a: Coordinates | undefined, b: Coordinates): boolean {
  if (a === undefined) return false;
  return (
    Math.abs(a.latitude - b.latitude) <= SAME_DOOR_DEGREES &&
    Math.abs(a.longitude - b.longitude) <= SAME_DOOR_DEGREES
  );
}

// A driver standing at the door knows better than any geocoder. Agreement between drivers
// raises confidence towards, but never to, certainty: a shop moves, a building is renumbered.
export function confirmPin(address: Address, command: ConfirmPinCommand): Address {
  assertCoordinates(command);

  const agrees = address.source === "driver" && nearby(address.location, command);
  const confirmations = agrees ? address.confirmations + 1 : 1;

  return {
    ...address,
    location: { latitude: command.latitude, longitude: command.longitude },
    source: "driver",
    confirmations,
    // Starts above anything a geocoder can reach and climbs towards, but never to, certainty:
    // a shop moves, a building is renumbered, a gate is locked.
    confidence: FIELD_EVIDENCE_FLOOR + (1 - FIELD_EVIDENCE_FLOOR) * (1 - 1 / confirmations),
    lastConfirmedBy: command.workerId,
    lastConfirmedAt: command.at,
  };
}
