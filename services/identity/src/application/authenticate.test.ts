import { beforeEach, describe, expect, it } from "vitest";
import { authenticate, authorise } from "./authenticate.js";
import { issueKey, listKeys, registerTenant, revokeKey } from "./manage-keys.js";
import { countingIds, fixedClock, fixedSecrets, inMemoryIdentity } from "./test-doubles.js";
import type { IdentityDeps } from "./ports.js";

let deps: IdentityDeps;

beforeEach(() => {
  deps = {
    repository: inMemoryIdentity(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
    secrets: fixedSecrets(),
  };
});

const tenantInput = {
  name: "Bengaluru Couriers",
  countryCode: "IN",
  currency: "INR",
  locale: "en-IN",
  region: "ap-south",
};

async function withKey(scopes: string[] = ["consignments:write"]): Promise<{
  tenantId: string;
  secret: string;
  keyId: string;
}> {
  const tenant = await registerTenant(deps, tenantInput);
  const key = await issueKey(deps, { tenantId: tenant.id, name: "integration", scopes });
  return { tenantId: tenant.id, secret: key.secret, keyId: key.id };
}

describe("authenticating a caller", () => {
  it("identifies the tenant behind a valid key", async () => {
    const { tenantId, secret } = await withKey();

    const caller = await authenticate(deps.repository, secret);

    expect(caller.tenantId).toBe(tenantId);
    expect(caller.scopes).toEqual(["consignments:write"]);
  });

  it("refuses a key nobody issued", async () => {
    await withKey();

    await expect(authenticate(deps.repository, "rsk_" + "z".repeat(48))).rejects.toThrow(
      "the credential presented is not usable",
    );
  });

  it("refuses when nothing was presented", async () => {
    await expect(authenticate(deps.repository, undefined)).rejects.toThrow(/not usable/);
    await expect(authenticate(deps.repository, "")).rejects.toThrow(/not usable/);
  });

  it("refuses a revoked key", async () => {
    const { tenantId, secret, keyId } = await withKey();

    await revokeKey(deps, tenantId, keyId);

    await expect(authenticate(deps.repository, secret)).rejects.toThrow(/not usable/);
  });

  it("refuses a key belonging to a disabled tenant", async () => {
    const { tenantId, secret } = await withKey();
    const tenant = await deps.repository.tenantById(tenantId);
    if (tenant === undefined) throw new Error("expected the tenant to exist");
    await deps.repository.saveTenant({ ...tenant, active: false });

    await expect(authenticate(deps.repository, secret)).rejects.toThrow(/not usable/);
  });

  it("says the same thing however it failed, so keys cannot be probed", async () => {
    const { tenantId, secret, keyId } = await withKey();
    await revokeKey(deps, tenantId, keyId);

    const messages: string[] = [];
    for (const candidate of [undefined, "", "rsk_" + "z".repeat(48), secret]) {
      await authenticate(deps.repository, candidate).catch((error: unknown) => {
        messages.push(error instanceof Error ? error.message : "");
      });
    }

    expect(new Set(messages).size).toBe(1);
  });

  it("never returns the secret or its hash to the caller", async () => {
    const { secret } = await withKey();

    const caller = await authenticate(deps.repository, secret);

    expect(JSON.stringify(caller)).not.toContain(secret);
    expect(Object.keys(caller)).toEqual(["tenantId", "keyId", "fingerprint", "scopes"]);
  });
});

describe("what a caller may do", () => {
  it("permits a scope the key holds", async () => {
    const { secret } = await withKey(["runs:write"]);
    const caller = await authenticate(deps.repository, secret);

    expect(() => { authorise(caller, "runs:read"); }).not.toThrow();
  });

  it("refuses a scope the key lacks, and says which", async () => {
    const { secret } = await withKey(["runs:read"]);
    const caller = await authenticate(deps.repository, secret);

    expect(() => { authorise(caller, "runs:write"); }).toThrow("this credential lacks the runs:write scope");
  });

  it("keeps personal data behind its own scope", async () => {
    const { secret } = await withKey(["consignments:write", "runs:write"]);
    const caller = await authenticate(deps.repository, secret);

    expect(() => { authorise(caller, "pii:read"); }).toThrow(/pii:read/);
  });
});

describe("managing keys", () => {
  it("returns the secret once and never stores it", async () => {
    const tenant = await registerTenant(deps, tenantInput);

    const key = await issueKey(deps, {
      tenantId: tenant.id,
      name: "n",
      scopes: ["consignments:read"],
    });
    const stored = await listKeys(deps, tenant.id);

    expect(JSON.stringify(stored)).not.toContain(key.secret);
  });

  it("refuses to issue a key for a tenant that does not exist", async () => {
    await expect(
      issueKey(deps, { tenantId: "nope", name: "n", scopes: ["consignments:read"] }),
    ).rejects.toThrow("no tenant with that identifier");
  });

  it("refuses to revoke a key that is not there", async () => {
    const tenant = await registerTenant(deps, tenantInput);

    await expect(revokeKey(deps, tenant.id, "nope")).rejects.toThrow(/no usable key/);
  });

  it("refuses to revoke another tenant's key", async () => {
    const { keyId } = await withKey();

    await expect(revokeKey(deps, "someone-else", keyId)).rejects.toThrow(/no usable key/);
  });
});
