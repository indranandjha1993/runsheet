import type { ApiKey } from "../domain/api-key.js";
import type { Tenant } from "../domain/tenant.js";
import type { Clock, Identifiers, IdentityRepository, Secrets } from "./ports.js";

export function inMemoryIdentity(): IdentityRepository {
  const tenants = new Map<string, Tenant>();
  const keys = new Map<string, ApiKey>();

  return {
    saveTenant: (tenant) => {
      tenants.set(tenant.id, tenant);
      return Promise.resolve();
    },
    tenantById: (id) => Promise.resolve(tenants.get(id)),
    saveKey: (key) => {
      keys.set(key.secretHash, key);
      return Promise.resolve();
    },
    keyBySecretHash: (hash) => Promise.resolve(keys.get(hash)),
    keysFor: (tenantId) =>
      Promise.resolve([...keys.values()].filter((key) => key.tenantId === tenantId)),
    revokeKey: (tenantId, id, at) => {
      for (const [hash, key] of keys) {
        if (key.tenantId === tenantId && key.id === id && key.revokedAt === undefined) {
          keys.set(hash, { ...key, revokedAt: at });
          return Promise.resolve(true);
        }
      }
      return Promise.resolve(false);
    },
  };
}

export function fixedClock(at: string): Clock {
  return { now: () => new Date(at) };
}

export function countingIds(): Identifiers {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `01J8Z0T00000000000000${String(n).padStart(5, "0")}`;
    },
  };
}

export function fixedSecrets(): Secrets {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `${String(n).padStart(2, "0")}${"x".repeat(46)}`;
    },
  };
}
