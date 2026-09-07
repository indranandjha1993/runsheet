import { beforeEach, describe, expect, it } from "vitest";
import { confirm, resolve } from "./resolve.js";
import {
  countingIds,
  fixedClock,
  fixedGeocoder,
  inMemoryAddresses,
  recordingPublisher,
  silentGeocoder,
} from "./test-doubles.js";
import type { AddressDeps } from "./ports.js";

const tenantId = "01J8Z0T0000000000000000002";
const raw = "Flat 4B, near Sai Temple, Indiranagar, Bengaluru 560038";

let deps: AddressDeps & { publisher: ReturnType<typeof recordingPublisher> };

beforeEach(() => {
  deps = {
    repository: inMemoryAddresses(),
    geocoder: fixedGeocoder(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
  };
});

describe("resolving an address", () => {
  it("parses it, places it, and announces it", async () => {
    const address = await resolve(deps, { tenantId, raw, countryCode: "IN" });

    expect(address.parsed.landmark).toBe("Sai Temple");
    expect(address.parsed.postcode).toBe("560038");
    expect(deps.publisher.published[0]?.event.type).toBe("address.resolved");
    expect(deps.publisher.published[0]?.payload).toMatchObject({ has_landmark: true });
  });

  it("returns the address it already knows rather than geocoding again", async () => {
    const first = await resolve(deps, { tenantId, raw, countryCode: "IN" });
    deps.publisher.published.length = 0;

    const second = await resolve(deps, { tenantId, raw, countryCode: "IN" });

    expect(second.id).toBe(first.id);
    expect(deps.publisher.published).toHaveLength(0);
  });

  it("keeps one tenant's addresses out of another's", async () => {
    const mine = await resolve(deps, { tenantId, raw, countryCode: "IN" });
    const theirs = await resolve(deps, { tenantId: "other", raw, countryCode: "IN" });

    expect(theirs.id).not.toBe(mine.id);
  });

  it("stores an address even when nothing could place it", async () => {
    deps = { ...deps, geocoder: silentGeocoder() };

    const address = await resolve(deps, { tenantId, raw: "somewhere near the lake", countryCode: "IN" });

    expect(address.location).toBeUndefined();
    expect(address.source).toBe("none");
    expect(deps.publisher.published[0]?.payload).toMatchObject({ source: "none" });
  });

  it("refuses empty text and announces nothing", async () => {
    await expect(resolve(deps, { tenantId, raw: "   ", countryCode: "IN" })).rejects.toThrow();

    expect(deps.publisher.published).toHaveLength(0);
  });
});

describe("a driver correcting the pin", () => {
  it("moves it, raises the confidence, and announces the correction", async () => {
    const address = await resolve(deps, { tenantId, raw, countryCode: "IN" });
    deps.publisher.published.length = 0;

    const corrected = await confirm(deps, {
      tenantId,
      addressId: address.id,
      latitude: 12.9712,
      longitude: 77.6402,
      workerId: "w1",
    });

    expect(corrected.source).toBe("driver");
    expect(corrected.confidence).toBeGreaterThan(address.confidence);
    expect(deps.publisher.published[0]?.event.type).toBe("address.corrected");
  });

  it("means the next booking to that door gets the corrected pin", async () => {
    const address = await resolve(deps, { tenantId, raw, countryCode: "IN" });
    await confirm(deps, {
      tenantId,
      addressId: address.id,
      latitude: 12.9712,
      longitude: 77.6402,
      workerId: "w1",
    });

    const again = await resolve(deps, { tenantId, raw, countryCode: "IN" });

    expect(again.location?.latitude).toBe(12.9712);
    expect(again.source).toBe("driver");
  });

  it("grows more certain as drivers agree", async () => {
    const address = await resolve(deps, { tenantId, raw, countryCode: "IN" });
    const at = { tenantId, addressId: address.id, latitude: 12.9712, longitude: 77.6402 };

    const once = await confirm(deps, { ...at, workerId: "w1" });
    const twice = await confirm(deps, { ...at, workerId: "w2" });

    expect(twice.confidence).toBeGreaterThan(once.confidence);
    expect(deps.publisher.published.at(-1)?.payload).toMatchObject({ confirmations: 2 });
  });

  it("reports an address nobody stored", async () => {
    await expect(
      confirm(deps, { tenantId, addressId: "nope", latitude: 1, longitude: 1, workerId: "w" }),
    ).rejects.toThrow("no address with that identifier");
  });

  it("keeps one tenant from moving another's pin", async () => {
    const address = await resolve(deps, { tenantId, raw, countryCode: "IN" });

    await expect(
      confirm(deps, {
        tenantId: "other",
        addressId: address.id,
        latitude: 1,
        longitude: 1,
        workerId: "w",
      }),
    ).rejects.toThrow("no address with that identifier");
  });
});
