import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { identityRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  fixedSecrets,
  inMemoryIdentity,
} from "../application/test-doubles.js";

const tenantBody = {
  name: "Bengaluru Couriers",
  country_code: "IN",
  currency: "INR",
  locale: "en-IN",
  region: "ap-south",
};

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(
    identityRoutes({
      repository: inMemoryIdentity(),
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
      ids: countingIds(),
      secrets: fixedSecrets(),
    }),
  );
});

const post = (
  url: string,
  body: unknown,
  headers = {},
): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "POST", url, headers, body });

const get = (url: string, headers = {}): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "GET", url, headers, body: undefined });

async function tenantAndKey(
  scopes: string[] = ["consignments:write"],
): Promise<{ tenantId: string; secret: string; keyId: string }> {
  const tenant = (await post("/v1/tenants", tenantBody)).body as { id: string };
  const key = (await post("/v1/keys", { tenant_id: tenant.id, name: "n", scopes })).body as {
    id: string;
    secret: string;
  };
  return { tenantId: tenant.id, secret: key.secret, keyId: key.id };
}

describe("registering a tenant", () => {
  it("creates it with everything it needs to operate", async () => {
    const response = await post("/v1/tenants", tenantBody);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ currency: "INR", active: true });
  });

  it("refuses a country code that is not one", async () => {
    expect((await post("/v1/tenants", { ...tenantBody, country_code: "IND" })).status).toBe(400);
  });

  it("refuses a region the platform does not run in", async () => {
    expect((await post("/v1/tenants", { ...tenantBody, region: "mars-1" })).status).toBe(400);
  });

  it("can be read back", async () => {
    const { tenantId } = await tenantAndKey();

    expect((await get(`/v1/tenants/${tenantId}`)).body).toMatchObject({ id: tenantId });
  });

  it("reports one that does not exist", async () => {
    expect((await get("/v1/tenants/nope")).status).toBe(404);
  });
});

describe("issuing keys", () => {
  it("returns the secret once with a warning that it will not be shown again", async () => {
    const { tenantId } = await tenantAndKey();

    const response = await post("/v1/keys", {
      tenant_id: tenantId,
      name: "second",
      scopes: ["runs:read"],
    });

    expect(response.status).toBe(201);
    const body = response.body as { warning: string; secret: string };
    expect(body.warning).toContain("cannot be shown");
    expect(body.secret.startsWith("rsk_")).toBe(true);
  });

  it("refuses a key for a tenant nobody registered", async () => {
    expect(
      (await post("/v1/keys", { tenant_id: "nope", name: "n", scopes: ["runs:read"] })).status,
    ).toBe(404);
  });

  it("refuses a scope nobody defined", async () => {
    const { tenantId } = await tenantAndKey();

    expect(
      (await post("/v1/keys", { tenant_id: tenantId, name: "n", scopes: ["everything"] })).status,
    ).toBe(400);
  });

  it("refuses a malformed request", async () => {
    expect((await post("/v1/keys", { name: "n" })).status).toBe(400);
  });

  it("lists keys without ever showing a secret", async () => {
    const { tenantId, secret } = await tenantAndKey();

    const response = await get(`/v1/tenants/${tenantId}/keys`);

    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(response.body).toMatchObject([{ name: "n", revoked: false }]);
  });
});

describe("revoking a key", () => {
  it("revokes it and shows it as revoked afterwards", async () => {
    const { tenantId, keyId } = await tenantAndKey();

    expect((await post(`/v1/keys/${keyId}/revoke`, { tenant_id: tenantId })).status).toBe(200);
    expect((await get(`/v1/tenants/${tenantId}/keys`)).body).toMatchObject([{ revoked: true }]);
  });

  it("refuses a revoke request that names no tenant", async () => {
    const { keyId } = await tenantAndKey();

    expect((await post(`/v1/keys/${keyId}/revoke`, {})).status).toBe(400);
  });

  it("reports a key that is not there", async () => {
    const { tenantId } = await tenantAndKey();

    expect((await post("/v1/keys/nope/revoke", { tenant_id: tenantId })).status).toBe(404);
  });
});

describe("telling another service who is calling", () => {
  it("returns the caller behind a valid credential", async () => {
    const { tenantId, secret } = await tenantAndKey();

    const response = await get("/v1/callers/current", { authorization: `Bearer ${secret}` });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ tenantId, scopes: ["consignments:write"] });
  });

  it("refuses a credential nobody issued", async () => {
    await tenantAndKey();

    expect((await get("/v1/callers/current", { authorization: "Bearer rsk_forged" })).status).toBe(
      401,
    );
  });

  it("refuses a request with no credential", async () => {
    expect((await get("/v1/callers/current")).status).toBe(401);
  });

  it("refuses a header that is not a bearer credential", async () => {
    expect((await get("/v1/callers/current", { authorization: "Basic abc" })).status).toBe(401);
  });

  it("refuses a revoked credential", async () => {
    const { tenantId, secret, keyId } = await tenantAndKey();
    await post(`/v1/keys/${keyId}/revoke`, { tenant_id: tenantId });

    expect((await get("/v1/callers/current", { authorization: `Bearer ${secret}` })).status).toBe(
      401,
    );
  });

  it("never returns the secret or its hash", async () => {
    const { secret } = await tenantAndKey();

    const response = await get("/v1/callers/current", { authorization: `Bearer ${secret}` });

    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(JSON.stringify(response.body)).not.toContain("secretHash");
  });
});
