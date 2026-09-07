import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresAddresses } from "./repository.js";
import { confirmPin, resolveAddress } from "../domain/address.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_address",
});
const repository = postgresAddresses(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";
const at = new Date("2026-09-07T10:00:00.000Z");
const raw = "Flat 4B, near Sai Temple, Indiranagar, Bengaluru 560038";

const sample = () =>
  resolveAddress({
    id: "01J8Z0T0000000000000000010",
    tenantId,
    raw,
    countryCode: "IN",
    geocoded: { latitude: 12.97, longitude: 77.64, confidence: 0.6 },
    at,
  });

beforeEach(async () => {
  await pool.query("DROP TABLE IF EXISTS addresses, aggregate_streams, schema_migrations CASCADE");
  await migrate(pool, migrations);
});

afterAll(async () => {
  await pool.end();
});

describe("the address repository", () => {
  it("round-trips an address with everything the parser found", async () => {
    await repository.save(sample());

    expect(await repository.byId(tenantId, sample().id)).toEqual(sample());
  });

  it("round-trips one that nothing could place", async () => {
    const unplaced = resolveAddress({
      id: "01J8Z0T0000000000000000011",
      tenantId,
      raw: "somewhere near the lake",
      countryCode: "IN",
      at,
    });

    await repository.save(unplaced);

    expect(await repository.byId(tenantId, unplaced.id)).toEqual(unplaced);
  });

  it("finds an address again by the exact text it was given", async () => {
    await repository.save(sample());

    expect((await repository.byText(tenantId, raw))?.id).toBe(sample().id);
    expect(await repository.byText(tenantId, "different text")).toBeUndefined();
  });

  it("keeps one tenant's addresses invisible to another", async () => {
    await repository.save(sample());

    expect(await repository.byId("other", sample().id)).toBeUndefined();
    expect(await repository.byText("other", raw)).toBeUndefined();
  });

  it("stores a driver's correction over the geocoder's guess", async () => {
    await repository.save(sample());
    const corrected = confirmPin(sample(), {
      latitude: 12.9712,
      longitude: 77.6402,
      workerId: "w1",
      at: new Date("2026-09-07T11:00:00.000Z"),
    });

    await repository.save(corrected);

    expect(await repository.byId(tenantId, sample().id)).toEqual(corrected);
  });

  it("refuses two addresses with the same text in one tenant", async () => {
    await repository.save(sample());

    await expect(
      repository.save({ ...sample(), id: "01J8Z0T0000000000000000099" }),
    ).rejects.toThrow();
  });

  it("hands out stream positions that never repeat", async () => {
    expect([
      await repository.nextSequence(tenantId, "a"),
      await repository.nextSequence(tenantId, "a"),
    ]).toEqual([1, 2]);
  });
});
