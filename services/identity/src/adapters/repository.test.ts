import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresIdentity } from "./repository.js";
import { issue } from "../domain/api-key.js";
import { createTenant } from "../domain/tenant.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_identity",
});
const repository = postgresIdentity(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;

const tenant = createTenant({
  id: "01J8Z0T0000000000000000002",
  name: "Bengaluru Couriers",
  countryCode: "IN",
  currency: "INR",
  locale: "en-IN",
  region: "ap-south",
});

const issued = issue({
  id: "01J8Z0T0000000000000000010",
  tenantId: tenant.id,
  name: "integration",
  scopes: ["consignments:write", "pii:read"],
  secret: "a".repeat(48),
});

beforeEach(async () => {
  await pool.query("DROP TABLE IF EXISTS api_keys, tenants, schema_migrations CASCADE");
  await migrate(pool, migrations);
  await repository.saveTenant(tenant);
});

afterAll(async () => {
  await pool.end();
});

describe("the identity repository", () => {
  it("round-trips a tenant", async () => {
    expect(await repository.tenantById(tenant.id)).toEqual(tenant);
  });

  it("reports a tenant nobody registered", async () => {
    expect(await repository.tenantById("nope")).toBeUndefined();
  });

  it("round-trips a key with its scopes", async () => {
    await repository.saveKey(issued.record);

    expect(await repository.keyBySecretHash(issued.record.secretHash)).toEqual(issued.record);
  });

  it("finds nothing for a hash it never stored", async () => {
    expect(await repository.keyBySecretHash("nope")).toBeUndefined();
  });

  it("stores no trace of the secret itself", async () => {
    await repository.saveKey(issued.record);

    const dump = await pool.query<{ row: string }>("SELECT api_keys::text AS row FROM api_keys");
    expect(dump.rows[0]?.row).not.toContain("a".repeat(48));
  });

  it("revokes a key once and refuses to revoke it twice", async () => {
    await repository.saveKey(issued.record);
    const at = new Date("2026-09-07T10:00:00.000Z");

    expect(await repository.revokeKey(tenant.id, issued.record.id, at)).toBe(true);
    expect(await repository.revokeKey(tenant.id, issued.record.id, at)).toBe(false);
  });

  it("will not let one tenant revoke another's key", async () => {
    await repository.saveKey(issued.record);

    expect(
      await repository.revokeKey("someone-else", issued.record.id, new Date()),
    ).toBe(false);
  });

  it("reads back a revoked key so authentication can refuse it", async () => {
    await repository.saveKey(issued.record);
    await repository.revokeKey(tenant.id, issued.record.id, new Date("2026-09-07T10:00:00.000Z"));

    const stored = await repository.keyBySecretHash(issued.record.secretHash);

    expect(stored?.revokedAt).toBeInstanceOf(Date);
  });

  it("lists the keys a tenant holds", async () => {
    await repository.saveKey(issued.record);

    expect((await repository.keysFor(tenant.id)).map((k) => k.name)).toEqual(["integration"]);
    expect(await repository.keysFor("someone-else")).toHaveLength(0);
  });

  it("refuses two keys hashing to the same secret", async () => {
    await repository.saveKey(issued.record);

    await expect(
      repository.saveKey({ ...issued.record, id: "01J8Z0T0000000000000000011" }),
    ).rejects.toThrow();
  });
});
