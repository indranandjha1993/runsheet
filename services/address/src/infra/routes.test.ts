import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { addressRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  fixedGeocoder,
  inMemoryAddresses,
  recordingPublisher,
} from "../application/test-doubles.js";

const tenantId = "01J8Z0T0000000000000000002";
const tenant = { authorization: "Bearer rsk_test" };
const raw = "Flat 4B, near Sai Temple, Indiranagar, Bengaluru 560038";

const lookup = (
  presented: string,
): Promise<
  { tenantId: string; keyId: string; fingerprint: string; scopes: string[] } | undefined
> =>
  Promise.resolve(
    presented === "rsk_test"
      ? { tenantId, keyId: "k1", fingerprint: "abc123def456", scopes: ["addresses:write"] }
      : undefined,
  );

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(
    addressRoutes({
      lookup,
      repository: inMemoryAddresses(),
      geocoder: fixedGeocoder(),
      publisher: recordingPublisher(),
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
      ids: countingIds(),
    }),
  );
});

const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = tenant,
): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "POST", url, headers, body });

interface Resolved {
  id: string;
  confidence: number;
  source: string;
  location?: { latitude: number };
  parsed: { landmark?: string; postcode?: string };
}

describe("resolving over the api", () => {
  it("returns the address with what the parser found", async () => {
    const response = await post("/v1/addresses", { raw, country_code: "IN" });

    expect(response.status).toBe(201);
    expect((response.body as Resolved).parsed).toMatchObject({
      landmark: "Sai Temple",
      postcode: "560038",
    });
  });

  it("refuses empty text", async () => {
    expect((await post("/v1/addresses", { raw: "", country_code: "IN" })).status).toBe(400);
  });

  it("refuses a country code that is not one", async () => {
    expect((await post("/v1/addresses", { raw, country_code: "IND" })).status).toBe(400);
  });

  it("refuses a request with no credential", async () => {
    expect((await post("/v1/addresses", { raw, country_code: "IN" }, {})).status).toBe(401);
  });
});

describe("correcting a pin over the api", () => {
  it("moves it and raises the confidence", async () => {
    const first = (await post("/v1/addresses", { raw, country_code: "IN" })).body as Resolved;

    const corrected = (
      await post(`/v1/addresses/${first.id}/confirm`, {
        latitude: 12.9712,
        longitude: 77.6402,
        worker_id: "w1",
      })
    ).body as Resolved;

    expect(corrected.source).toBe("driver");
    expect(corrected.confidence).toBeGreaterThan(first.confidence);
  });

  it("means the next resolution of that text gets the corrected pin", async () => {
    const first = (await post("/v1/addresses", { raw, country_code: "IN" })).body as Resolved;
    await post(`/v1/addresses/${first.id}/confirm`, {
      latitude: 12.9712,
      longitude: 77.6402,
      worker_id: "w1",
    });

    const again = (await post("/v1/addresses", { raw, country_code: "IN" })).body as Resolved;

    expect(again.location?.latitude).toBe(12.9712);
  });

  it("refuses a pin outside the possible range", async () => {
    const first = (await post("/v1/addresses", { raw, country_code: "IN" })).body as Resolved;

    const response = await post(`/v1/addresses/${first.id}/confirm`, {
      latitude: 91,
      longitude: 0,
      worker_id: "w1",
    });

    expect(response.status).toBe(400);
  });

  it("refuses a malformed correction", async () => {
    expect((await post("/v1/addresses/anything/confirm", { latitude: 1 })).status).toBe(400);
  });

  it("reports an address nobody stored", async () => {
    const response = await post("/v1/addresses/nope/confirm", {
      latitude: 12.97,
      longitude: 77.64,
      worker_id: "w1",
    });

    expect(response.status).toBe(404);
  });
});

describe("reading an address", () => {
  it("returns it", async () => {
    const first = (await post("/v1/addresses", { raw, country_code: "IN" })).body as Resolved;

    const response = await router.handle({
      method: "GET",
      url: `/v1/addresses/${first.id}`,
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
  });

  it("reports one that does not exist", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/addresses/nope",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(404);
  });
});
