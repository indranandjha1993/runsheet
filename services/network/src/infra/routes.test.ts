import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { networkRoutes } from "./routes.js";
import { polygon } from "../domain/geo.js";
import { lane } from "../domain/lane.js";
import {
  countingIds,
  fixedClock,
  inMemoryNetwork,
  recordingPublisher,
} from "../application/test-doubles.js";

const tenantId = "01J8Z0T0000000000000000002";
const tenant = { authorization: "Bearer rsk_test" };

const lookup = (
  presented: string,
): Promise<
  { tenantId: string; keyId: string; fingerprint: string; scopes: string[] } | undefined
> =>
  Promise.resolve(
    presented === "rsk_test"
      ? { tenantId, keyId: "k1", fingerprint: "abc123def456", scopes: ["network:write"] }
      : undefined,
  );
const validHub = {
  code: "BLR-01",
  name: "Bengaluru South",
  country_code: "IN",
  time_zone: "Asia/Kolkata",
  latitude: 12.96,
  longitude: 77.6,
  opens_minutes_of_day: 360,
  closes_minutes_of_day: 1320,
};

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  router = createRouter(
    networkRoutes({
      lookup,
      repository: inMemoryNetwork(),
      publisher: recordingPublisher(),
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
      ids: countingIds(),
    }),
  );
});

describe("network routes", () => {
  it("creates a hub and returns where to find it", async () => {
    const response = await router.handle({
      method: "POST",
      url: "/v1/hubs",
      headers: tenant,
      body: validHub,
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ code: "BLR-01" });
  });

  it("ignores a tenant header, so nobody can create a hub in another account", async () => {
    const response = await router.handle({
      method: "POST",
      url: "/v1/hubs",
      headers: { ...tenant, "x-tenant-id": "01J8Z0T0000000000000000099" },
      body: validHub,
    });

    expect(response.status).toBe(201);
  });

  it("reports a duplicate hub as a conflict rather than a server failure", async () => {
    const create = (): Promise<unknown> =>
      router.handle({ method: "POST", url: "/v1/hubs", headers: tenant, body: validHub });
    await create();

    const response = (await create()) as { status: number; body: unknown };

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: "already_exists" } });
  });

  it("explains what was wrong with the body rather than failing opaquely", async () => {
    const response = await router.handle({
      method: "POST",
      url: "/v1/hubs",
      headers: tenant,
      body: { ...validHub, country_code: "IND" },
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: "invalid_request" } });
  });

  it("answers a serviceability question for a location nothing covers", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/serviceability?latitude=12.96&longitude=77.6&service=next_day",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      serviceable: false,
      reason: "no_zone_covers_this_location",
    });
  });

  it("answers with the serving hub and a promise once the network is set up", async () => {
    const repository = inMemoryNetwork();
    const wired = createRouter(
      networkRoutes({
        lookup,
        repository,
        publisher: recordingPublisher(),
        clock: fixedClock("2026-09-07T10:00:00.000Z"),
        ids: countingIds(),
      }),
    );
    await wired.handle({ method: "POST", url: "/v1/hubs", headers: tenant, body: validHub });
    const created = await repository.hubByCode(tenantId, "BLR-01");
    await repository.saveZone(tenantId, {
      id: "z-1",
      hubId: created?.id ?? "",
      priority: 0,
      boundary: polygon([
        [12.97, 77.59],
        [12.97, 77.61],
        [12.95, 77.61],
        [12.95, 77.59],
      ]),
      active: true,
    });
    await repository.saveLane(
      tenantId,
      lane({
        id: "ln-1",
        originHubId: created?.id ?? "",
        destinationHubId: "other",
        service: "next_day",
        transitHours: 14,
        cutoffMinutesOfDay: 1080,
        operatingDays: [1, 2, 3, 4, 5],
      }),
    );

    const response = await wired.handle({
      method: "GET",
      url: "/v1/serviceability?latitude=12.96&longitude=77.6&service=next_day",
      headers: tenant,
      body: undefined,
    });

    expect(response.body).toMatchObject({ serviceable: true, hubCode: "BLR-01" });
  });

  it("rejects a serviceability question missing its coordinates", async () => {
    const response = await router.handle({
      method: "GET",
      url: "/v1/serviceability?service=next_day",
      headers: tenant,
      body: undefined,
    });

    expect(response.status).toBe(400);
  });
});
