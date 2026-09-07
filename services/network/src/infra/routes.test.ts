import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { networkRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  inMemoryNetwork,
  recordingPublisher,
} from "../application/test-doubles.js";

const tenant = { "x-tenant-id": "01J8Z0T0000000000000000002" };
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

  it("refuses a request that names no tenant", async () => {
    const response = await router.handle({
      method: "POST",
      url: "/v1/hubs",
      headers: {},
      body: validHub,
    });

    expect(response.status).toBe(500);
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
