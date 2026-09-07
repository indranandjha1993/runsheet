import type { ApiKey } from "../domain/api-key.js";
import type { Tenant } from "../domain/tenant.js";

export interface IdentityRepository {
  saveTenant(tenant: Tenant): Promise<void>;
  tenantById(id: string): Promise<Tenant | undefined>;
  saveKey(key: ApiKey): Promise<void>;
  keyBySecretHash(hash: string): Promise<ApiKey | undefined>;
  keysFor(tenantId: string): Promise<ApiKey[]>;
  revokeKey(tenantId: string, id: string, at: Date): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

export interface Identifiers {
  next(): string;
}

export interface Secrets {
  next(): string;
}

export interface IdentityDeps {
  readonly repository: IdentityRepository;
  readonly clock: Clock;
  readonly ids: Identifiers;
  readonly secrets: Secrets;
}
