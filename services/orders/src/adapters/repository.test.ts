import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "@runsheet/runtime";
import { postgresOrders } from "./repository.js";
import { apply, book, type Consignment } from "../domain/consignment.js";

const pool = new Pool({
  connectionString: "postgres://runsheet:runsheet@localhost:15432/test_orders",
});
const repository = postgresOrders(pool);
const migrations = new URL("../../migrations", import.meta.url).pathname;
const tenantId = "01J8Z0T0000000000000000002";
const orderId = "01J8Z0T0000000000000000003";

const sample = (): Consignment =>
  book({
    id: "01J8Z0T0000000000000000010",
    tenantId,
    orderId,
    originHubCode: "BLR1",
    destinationHubCode: "DEL3",
    service: "next_day",
    paymentMode: "cod",
    guards: {
      proofRequirement: "photo",
      attemptLimit: 3,
      codAmountMinor: 1000,
      codCurrency: "INR",
    },
    packages: [
      { id: "01J8Z0T0000000000000000011", weightGrams: 1200 },
      { id: "01J8Z0T0000000000000000012", weightGrams: 800 },
    ],
  });

beforeEach(async () => {
  await pool.query(
    "DROP TABLE IF EXISTS consignment_serials, parcel_serials, packages, consignments, orders,\n       aggregate_streams, schema_migrations CASCADE",
  );
  await migrate(pool, migrations);
  await repository.saveOrder({ id: orderId, tenantId, reference: "ORD-1001", paymentMode: "cod" });
});

afterAll(async () => {
  await pool.end();
});

describe("the orders repository", () => {
  it("round-trips a consignment with its packages and guards", async () => {
    await repository.saveConsignment(sample(), 0);

    const found = await repository.consignmentById(tenantId, sample().id);

    expect(found?.consignment).toEqual(sample());
    expect(found?.version).toBe(1);
  });

  it("finds an order by the reference the customer gave us", async () => {
    expect((await repository.orderByReference(tenantId, "ORD-1001"))?.id).toBe(orderId);
    expect(await repository.orderByReference(tenantId, "ORD-NOPE")).toBeUndefined();
  });

  it("keeps one tenant's consignments invisible to another", async () => {
    await repository.saveConsignment(sample(), 0);

    expect(
      await repository.consignmentById("01J8Z0T0000000000000000099", sample().id),
    ).toBeUndefined();
  });

  it("refuses a write when someone else changed the consignment first", async () => {
    await repository.saveConsignment(sample(), 0);
    const moved = apply(sample(), { type: "picked_up" });

    await repository.saveConsignment(moved, 1);

    await expect(repository.saveConsignment(moved, 1)).rejects.toThrow(/changed while it was/);
  });

  it("advances the version on every write so a stale writer is caught", async () => {
    await repository.saveConsignment(sample(), 0);
    await repository.saveConsignment(apply(sample(), { type: "picked_up" }), 1);

    expect((await repository.consignmentById(tenantId, sample().id))?.version).toBe(2);
  });

  it("lists the consignments still in flight and leaves finished ones out", async () => {
    const delivered = {
      ...sample(),
      id: "01J8Z0T0000000000000000020",
      status: "delivered" as const,
      packages: [],
    };
    await repository.saveConsignment(sample(), 0);
    await repository.saveConsignment(delivered, 0);

    const open = await repository.openConsignments(tenantId, 10);

    expect(open.map((c) => c.id)).toEqual([sample().id]);
  });

  it("hands out stream positions that never repeat", async () => {
    expect([
      await repository.nextSequence(tenantId, "a"),
      await repository.nextSequence(tenantId, "a"),
      await repository.nextSequence(tenantId, "b"),
    ]).toEqual([1, 2, 1]);
  });
});

describe("reserving barcode serials", () => {
  it("gives a consignment the same block every time it is asked", async () => {
    const first = await repository.serialFor(tenantId, "c-1", 3);

    expect(await repository.serialFor(tenantId, "c-1", 3)).toBe(first);
  });

  it("leaves room for every piece before the next consignment starts", async () => {
    const first = await repository.serialFor(tenantId, "c-1", 3);
    const second = await repository.serialFor(tenantId, "c-2", 1);

    expect(second).toBeGreaterThanOrEqual(first + 3);
  });

  it("never gives two consignments the same starting serial", async () => {
    const blocks = await Promise.all(
      ["c-1", "c-2", "c-3", "c-4", "c-5"].map((id) => repository.serialFor(tenantId, id, 2)),
    );

    expect(new Set(blocks).size).toBe(blocks.length);
  });

  it("keeps blocks apart across tenants, because a hub sorts everyone's parcels together", async () => {
    const mine = await repository.serialFor(tenantId, "c-1", 1);
    const theirs = await repository.serialFor("other", "c-1", 1);

    expect(theirs).not.toBe(mine);
  });
});

describe("what comes back from the database, field by field", () => {
  it("keeps the delivery time, the hub and the run a consignment last touched", async () => {
    const consignment = sample();
    await repository.saveConsignment(consignment, 0);
    const delivered = {
      ...consignment,
      status: "delivered" as const,
      currentHubId: "DEL3",
      currentRunId: "run-1",
      deliveredAt: new Date("2026-09-09T11:00:00.000Z"),
    };
    await repository.saveConsignment(delivered, 1);

    const found = await repository.consignmentById(tenantId, consignment.id);

    expect(found?.consignment).toMatchObject({
      currentHubId: "DEL3",
      currentRunId: "run-1",
      deliveredAt: new Date("2026-09-09T11:00:00.000Z"),
    });
  });

  it("finds nothing for an order nobody placed", async () => {
    expect(await repository.orderById(tenantId, "nowhere")).toBeUndefined();
  });
});
