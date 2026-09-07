import type { Pool } from "pg";
import type { ApiKey, Scope } from "../domain/api-key.js";
import type { Region, Tenant } from "../domain/tenant.js";
import type { IdentityRepository } from "../application/ports.js";

interface TenantRow {
  id: string;
  name: string;
  country_code: string;
  currency: string;
  locale: string;
  region: string;
  active: boolean;
}

interface KeyRow {
  id: string;
  tenant_id: string;
  name: string;
  scopes: string[];
  secret_hash: string;
  fingerprint: string;
  revoked_at: Date | null;
}

const toTenant = (row: TenantRow): Tenant => ({
  id: row.id,
  name: row.name,
  countryCode: row.country_code,
  currency: row.currency,
  locale: row.locale,
  region: row.region as Region,
  active: row.active,
});

const toKey = (row: KeyRow): ApiKey => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  scopes: row.scopes as Scope[],
  secretHash: row.secret_hash,
  fingerprint: row.fingerprint,
  ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
});

function tenantQueries(pool: Pool): Pick<IdentityRepository, "saveTenant" | "tenantById"> {
  return {
    async saveTenant(tenant) {
      await pool.query(
        `INSERT INTO tenants (id, name, country_code, currency, locale, region, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, active = EXCLUDED.active,
           locale = EXCLUDED.locale, currency = EXCLUDED.currency`,
        [
          tenant.id,
          tenant.name,
          tenant.countryCode,
          tenant.currency,
          tenant.locale,
          tenant.region,
          tenant.active,
        ],
      );
    },
    async tenantById(id) {
      const result = await pool.query<TenantRow>("SELECT * FROM tenants WHERE id = $1", [id]);
      const row = result.rows[0];
      return row === undefined ? undefined : toTenant(row);
    },
  };
}

function keyQueries(
  pool: Pool,
): Pick<IdentityRepository, "saveKey" | "keyBySecretHash" | "keysFor" | "revokeKey"> {
  return {
    async saveKey(key) {
      await pool.query(
        `INSERT INTO api_keys (id, tenant_id, name, scopes, secret_hash, fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [key.id, key.tenantId, key.name, key.scopes, key.secretHash, key.fingerprint],
      );
    },
    async keyBySecretHash(hash) {
      const result = await pool.query<KeyRow>("SELECT * FROM api_keys WHERE secret_hash = $1", [
        hash,
      ]);
      const row = result.rows[0];
      return row === undefined ? undefined : toKey(row);
    },
    async keysFor(tenantId) {
      const result = await pool.query<KeyRow>(
        "SELECT * FROM api_keys WHERE tenant_id = $1 ORDER BY created_at",
        [tenantId],
      );
      return result.rows.map(toKey);
    },
    async revokeKey(tenantId, id, at) {
      const result = await pool.query(
        `UPDATE api_keys SET revoked_at = $3
         WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL`,
        [tenantId, id, at],
      );
      return result.rowCount === 1;
    },
  };
}

export function postgresIdentity(pool: Pool): IdentityRepository {
  return { ...tenantQueries(pool), ...keyQueries(pool) };
}
