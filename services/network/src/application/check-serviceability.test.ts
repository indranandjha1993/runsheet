import { beforeEach, describe, expect, it } from "vitest";
import { checkServiceability } from "./check-serviceability.js";
import { inMemoryNetwork } from "./test-doubles.js";
import { polygon } from "../domain/geo.js";
import { lane } from "../domain/lane.js";
import { hub } from "../domain/hub.js";

const tenantId = "01J8Z0T0000000000000000002";

const south = hub({
  id: "hub-south",
  tenantId,
  code: "BLR-01",
  name: "Bengaluru South",
  countryCode: "IN",
  timeZone: "Asia/Kolkata",
  location: { latitude: 12.96, longitude: 77.6 },
  opensMinutesOfDay: 360,
  closesMinutesOfDay: 1320,
});

let repository: ReturnType<typeof inMemoryNetwork>;

beforeEach(async () => {
  repository = inMemoryNetwork();
  await repository.saveHub(south);
  await repository.saveZone(tenantId, {
    id: "z-south",
    hubId: "hub-south",
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
      id: "ln-south-hyd",
      originHubId: "hub-south",
      destinationHubId: "hub-hyd",
      service: "next_day",
      transitHours: 14,
      cutoffMinutesOfDay: 1080,
      operatingDays: [1, 2, 3, 4, 5],
    }),
  );
});

const at = new Date("2026-09-07T10:00:00.000Z");

describe("checking serviceability", () => {
  it("names the hub that serves a location and what it can promise", async () => {
    const answer = await checkServiceability(
      { repository },
      { tenantId, latitude: 12.96, longitude: 77.6, service: "next_day", at },
    );

    expect(answer.serviceable).toBe(true);
    expect(answer.hubCode).toBe("BLR-01");
    expect(answer.zoneId).toBe("z-south");
    expect(answer.estimatedArrival).toEqual(new Date("2026-09-08T08:00:00.000Z"));
  });

  it("says plainly that nowhere covers the location, and why", async () => {
    const answer = await checkServiceability(
      { repository },
      { tenantId, latitude: 1, longitude: 1, service: "next_day", at },
    );

    expect(answer.serviceable).toBe(false);
    expect(answer.reason).toBe("no_zone_covers_this_location");
  });

  it("covers the location but not the service asked for", async () => {
    const answer = await checkServiceability(
      { repository },
      { tenantId, latitude: 12.96, longitude: 77.6, service: "same_day", at },
    );

    expect(answer.serviceable).toBe(false);
    expect(answer.reason).toBe("service_not_offered_from_this_hub");
    expect(answer.hubCode).toBe("BLR-01");
  });

  it("reports a zone pointing at a hub that no longer exists rather than pretending", async () => {
    await repository.saveZone(tenantId, {
      id: "z-orphan",
      hubId: "hub-gone",
      priority: 99,
      boundary: polygon([
        [12.97, 77.59],
        [12.97, 77.61],
        [12.95, 77.61],
        [12.95, 77.59],
      ]),
      active: true,
    });

    const answer = await checkServiceability(
      { repository },
      { tenantId, latitude: 12.96, longitude: 77.6, service: "next_day", at },
    );

    expect(answer.serviceable).toBe(false);
    expect(answer.reason).toBe("zone_points_at_a_missing_hub");
  });
});
