import { beforeEach, describe, expect, it } from "vitest";
import { registerHub } from "./register-hub.js";
import { inMemoryNetwork, recordingPublisher, fixedClock, countingIds } from "./test-doubles.js";

const command = {
  tenantId: "01J8Z0T0000000000000000002",
  code: "blr-01",
  name: "Bengaluru South",
  countryCode: "IN",
  timeZone: "Asia/Kolkata",
  latitude: 12.96,
  longitude: 77.6,
  opensMinutesOfDay: 360,
  closesMinutesOfDay: 1320,
};

let repository: ReturnType<typeof inMemoryNetwork>;
let publisher: ReturnType<typeof recordingPublisher>;

beforeEach(() => {
  repository = inMemoryNetwork();
  publisher = recordingPublisher();
});

const deps = (): Parameters<typeof registerHub>[0] => ({
  repository,
  publisher,
  clock: fixedClock("2026-09-07T10:00:00.000Z"),
  ids: countingIds(),
});

describe("registering a hub", () => {
  it("stores the hub and announces it", async () => {
    const hub = await registerHub(deps(), command);

    expect(hub.code).toBe("BLR-01");
    expect(await repository.hubByCode(command.tenantId, "BLR-01")).toBeDefined();
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]?.event.type).toBe("hub.created");
    expect(publisher.published[0]?.topic).toBe("network");
  });

  it("refuses a code already used in that tenant", async () => {
    await registerHub(deps(), command);

    await expect(registerHub(deps(), command)).rejects.toThrow(
      "a hub with code BLR-01 already exists",
    );
  });

  it("allows the same code in a different tenant", async () => {
    await registerHub(deps(), command);

    const other = await registerHub(deps(), {
      ...command,
      tenantId: "01J8Z0T0000000000000000099",
    });

    expect(other.code).toBe("BLR-01");
  });

  it("announces nothing when the hub is rejected", async () => {
    await expect(registerHub(deps(), { ...command, countryCode: "IND" })).rejects.toThrow();

    expect(publisher.published).toHaveLength(0);
  });

  it("carries the tenant and the moment it happened onto the event", async () => {
    await registerHub(deps(), command);
    const first = publisher.published[0];

    expect(first?.event.tenantId).toBe(command.tenantId);
    expect(first?.event.occurredAt).toEqual(new Date("2026-09-07T10:00:00.000Z"));
    expect(first?.event.sequence).toBe(1);
    expect(first?.event.source).toBe("api");
  });

  it("puts the hub's own details on the event, not just its identifier", async () => {
    await registerHub(deps(), command);

    expect(publisher.published[0]?.payload).toMatchObject({
      code: "BLR-01",
      country_code: "IN",
      time_zone: "Asia/Kolkata",
    });
  });
});
