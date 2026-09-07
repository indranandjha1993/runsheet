import { confirmPin, resolveAddress, type Address } from "../domain/address.js";
import { DomainError } from "../domain/errors.js";
import { announce } from "./announce.js";
import type { AddressDeps } from "./ports.js";

export interface ResolveCommand {
  readonly tenantId: string;
  readonly raw: string;
  readonly countryCode: string;
}

// The learning loop. The same text within a tenant returns the same address, so a pin a driver
// corrected once is reused for every later delivery to that door.
export async function resolve(deps: AddressDeps, command: ResolveCommand): Promise<Address> {
  const known = await deps.repository.byText(command.tenantId, command.raw);
  if (known !== undefined) return known;

  const geocoded = await deps.geocoder.locate(command.raw, command.countryCode);
  const address = resolveAddress({
    id: deps.ids.next(),
    tenantId: command.tenantId,
    raw: command.raw,
    countryCode: command.countryCode,
    at: deps.clock.now(),
    ...(geocoded === undefined ? {} : { geocoded }),
  });

  await deps.repository.save(address);
  await announce(deps, {
    tenantId: address.tenantId,
    aggregateType: "address",
    aggregateId: address.id,
    type: "address.resolved",
    topic: "address",
    payload: {
      country_code: address.parsed.countryCode,
      source: address.source,
      confidence: address.confidence,
      has_landmark: address.parsed.landmark !== undefined,
    },
  });

  return address;
}

export interface ConfirmCommand {
  readonly tenantId: string;
  readonly addressId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly workerId: string;
}

export async function confirm(deps: AddressDeps, command: ConfirmCommand): Promise<Address> {
  const known = await deps.repository.byId(command.tenantId, command.addressId);
  if (known === undefined) {
    throw new DomainError("not_found", "no address with that identifier");
  }

  const corrected = confirmPin(known, {
    latitude: command.latitude,
    longitude: command.longitude,
    workerId: command.workerId,
    at: deps.clock.now(),
  });

  await deps.repository.save(corrected);
  await announce(deps, {
    tenantId: corrected.tenantId,
    aggregateType: "address",
    aggregateId: corrected.id,
    type: "address.corrected",
    topic: "address",
    payload: {
      confirmations: corrected.confirmations,
      confidence: corrected.confidence,
      worker_id: command.workerId,
    },
  });

  return corrected;
}
