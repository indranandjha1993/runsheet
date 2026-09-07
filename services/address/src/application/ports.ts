import type { Envelope } from "@runsheet/kernel";
import type { Address, Coordinates } from "../domain/address.js";

export interface AddressRepository {
  save(address: Address): Promise<void>;
  byId(tenantId: string, id: string): Promise<Address | undefined>;
  byText(tenantId: string, raw: string): Promise<Address | undefined>;
  nextSequence(tenantId: string, aggregateId: string): Promise<number>;
}

export interface Geocoder {
  locate(
    raw: string,
    countryCode: string,
  ): Promise<(Coordinates & { readonly confidence: number }) | undefined>;
}

export interface EventPublisher {
  publish(event: Envelope, payload: Record<string, unknown>, topic: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface Identifiers {
  next(): string;
}

export interface AddressDeps {
  readonly repository: AddressRepository;
  readonly geocoder: Geocoder;
  readonly publisher: EventPublisher;
  readonly clock: Clock;
  readonly ids: Identifiers;
}
