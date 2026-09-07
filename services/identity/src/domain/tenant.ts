import { DomainError } from "./errors.js";

const COUNTRY = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

// Where a tenant's data lives. Adding one is a deployment decision, not a code change to callers.
export const REGIONS = ["ap-south", "me-central", "eu-west"] as const;
export type Region = (typeof REGIONS)[number];

export interface TenantInput {
  readonly id: string;
  readonly name: string;
  readonly countryCode: string;
  readonly currency: string;
  readonly locale: string;
  readonly region: string;
}

export interface Tenant extends Omit<TenantInput, "region"> {
  readonly region: Region;
  readonly active: boolean;
}

export function createTenant(input: TenantInput): Tenant {
  if (input.name.trim() === "") throw new DomainError("invalid_input", "name is required");
  if (!COUNTRY.test(input.countryCode)) {
    throw new DomainError("invalid_input", "countryCode must be a two-letter code");
  }
  if (!CURRENCY.test(input.currency)) {
    throw new DomainError("invalid_input", "currency must be a three-letter code");
  }
  if (input.locale.trim() === "") throw new DomainError("invalid_input", "locale is required");
  if (!REGIONS.includes(input.region as Region)) {
    throw new DomainError("invalid_input", `unknown region: ${input.region}`);
  }

  return { ...input, name: input.name.trim(), region: input.region as Region, active: true };
}
