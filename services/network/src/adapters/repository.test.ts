import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresNetwork } from "./repository.js";
import { hub } from "../domain/hub.js";
import { polygon } from "../domain/geo.js";
import { lane } from "../domain/lane.js";

const pool = new Pool({ connectionString: "postgres://runsheet:runsheet@localhost:15432/test_network" });
const repository = postgresNetwork(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";

const south = hub({
  id: "01J8Z0T0000000000000000010",
  tenantId,
  code: "BLR-01",
  name: "Bengaluru South",
  countryCode: "IN",
  timeZone: "Asia/Kolkata",
  location: { latitude: 12.96, longitude: 77.6 },
  opensMinutesOfDay: 360,
  closesMinutesOfDay: 1320,
});

beforeEach(async () => {
  await pool.query(
    "DROP TABLE IF EXISTS lanes, zones, hubs, aggregate_streams, schema_migrations CASCADE",
  );
  await migrate(pool, migrations);
});

afterAll(async () => {
  await pool.end();
});

describe("the network repository", () => {
  it("saves a hub and finds it again by code and by identifier", async () => {
    await repository.saveHub(south);

    expect((await repository.hubByCode(tenantId, "BLR-01"))?.name).toBe("Bengaluru South");
    expect((await repository.hubById(tenantId, south.id))?.code).toBe("BLR-01");
  });

  it("keeps one tenant's hubs invisible to another", async () => {
    await repository.saveHub(south);

    expect(await repository.hubByCode("01J8Z0T0000000000000000099", "BLR-01")).toBeUndefined();
    expect(await repository.hubById("01J8Z0T0000000000000000099", south.id)).toBeUndefined();
  });

  it("lets the database refuse a duplicate code rather than trusting the caller", async () => {
    await repository.saveHub(south);

    await expect(
      repository.saveHub({ ...south, id: "01J8Z0T0000000000000000011" }),
    ).rejects.toThrow();
  });

  it("round-trips a zone boundary without losing precision", async () => {
    await repository.saveHub(south);
    const boundary = polygon([
      [12.97, 77.59],
      [12.97, 77.61],
      [12.95, 77.61],
      [12.95, 77.59],
    ]);

    await repository.saveZone(tenantId, {
      id: "01J8Z0T0000000000000000020",
      hubId: south.id,
      priority: 5,
      boundary,
      active: true,
    });
    const [stored] = await repository.zonesFor(tenantId);

    expect(stored?.boundary.ring).toEqual(boundary.ring);
    expect(stored?.boundary.edges).toHaveLength(4);
    expect(stored?.priority).toBe(5);
  });

  it("returns only active zones, because an inactive one must not route work", async () => {
    await repository.saveHub(south);
    const boundary = polygon([
      [12.97, 77.59],
      [12.97, 77.61],
      [12.95, 77.61],
      [12.95, 77.59],
    ]);
    const base = { hubId: south.id, priority: 0, boundary };

    await repository.saveZone(tenantId, { ...base, id: "01J8Z0T0000000000000000021", active: true });
    await repository.saveZone(tenantId, { ...base, id: "01J8Z0T0000000000000000022", active: false });

    expect(await repository.zonesFor(tenantId)).toHaveLength(1);
  });

  it("round-trips a lane including its operating days", async () => {
    await repository.saveHub(south);
    const overnight = lane({
      id: "01J8Z0T0000000000000000030",
      originHubId: south.id,
      destinationHubId: "01J8Z0T0000000000000000031",
      service: "next_day",
      transitHours: 14,
      cutoffMinutesOfDay: 1080,
      operatingDays: [1, 2, 3, 4, 5],
    });

    await repository.saveLane(tenantId, overnight);
    const [stored] = await repository.lanesFrom(tenantId, south.id);

    expect(stored).toEqual(overnight);
  });

  it("reports a lane whose transit time the database rejects", async () => {
    await repository.saveHub(south);

    await expect(
      pool.query(
        `INSERT INTO lanes (id, tenant_id, origin_hub_id, destination_hub_id, service,
           transit_hours, cutoff_minutes_of_day, operating_days)
         VALUES ('x', $1, $2, 'other', 'next_day', 0, 1080, '{1}')`,
        [tenantId, south.id],
      ),
    ).rejects.toThrow(/lanes_transit_positive/);
  });

  it("hands out stream positions that never repeat for one aggregate", async () => {
    const positions = [
      await repository.nextSequence(tenantId, south.id),
      await repository.nextSequence(tenantId, south.id),
      await repository.nextSequence(tenantId, south.id),
    ];

    expect(positions).toEqual([1, 2, 3]);
    expect(await repository.nextSequence(tenantId, "01J8Z0T0000000000000000099")).toBe(1);
  });
});
