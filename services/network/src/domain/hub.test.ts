import { describe, expect, it } from "vitest";
import { hub, type HubInput } from "./hub.js";

const valid: HubInput = {
  id: "01J8Z0T0000000000000000001",
  tenantId: "01J8Z0T0000000000000000002",
  code: "BLR-01",
  name: "Bengaluru South",
  countryCode: "IN",
  timeZone: "Asia/Kolkata",
  location: { latitude: 12.96, longitude: 77.6 },
  opensMinutesOfDay: 6 * 60,
  closesMinutesOfDay: 22 * 60,
};

describe("hub", () => {
  it("accepts a well-formed hub", () => {
    expect(hub(valid).code).toBe("BLR-01");
  });

  it("normalises the code so lookups never miss on case or spacing", () => {
    expect(hub({ ...valid, code: " blr-01 " }).code).toBe("BLR-01");
  });

  it("rejects a code that could not be typed on a scanner", () => {
    expect(() => hub({ ...valid, code: "BLR 01" })).toThrow(
      "code may contain only letters, digits, and hyphens",
    );
    expect(() => hub({ ...valid, code: "" })).toThrow("code is required");
  });

  it("rejects a country it does not recognise", () => {
    expect(() => hub({ ...valid, countryCode: "IND" })).toThrow(
      "countryCode must be a two-letter code",
    );
  });

  it("rejects a time zone the platform cannot resolve", () => {
    expect(() => hub({ ...valid, timeZone: "Mars/Olympus" })).toThrow("unknown time zone");
  });

  it("rejects a blank name, which is how a bad import usually arrives", () => {
    expect(() => hub({ ...valid, name: "   " })).toThrow("name is required");
  });

  it("rejects opening hours outside the day", () => {
    expect(() => hub({ ...valid, opensMinutesOfDay: -1 })).toThrow(
      "opening hours must fall within the day",
    );
    expect(() => hub({ ...valid, closesMinutesOfDay: 1441 })).toThrow(
      "opening hours must fall within the day",
    );
  });

  it("rejects opening hours that never open", () => {
    expect(() => hub({ ...valid, opensMinutesOfDay: 22 * 60, closesMinutesOfDay: 6 * 60 })).toThrow(
      "a hub must open before it closes",
    );
  });

  it("allows a hub that is open around the clock", () => {
    expect(hub({ ...valid, opensMinutesOfDay: 0, closesMinutesOfDay: 1440 }).closesMinutesOfDay).toBe(
      1440,
    );
  });

  it("starts active, because a hub is created to be used", () => {
    expect(hub(valid).active).toBe(true);
  });
});
