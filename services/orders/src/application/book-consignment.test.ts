import { beforeEach, describe, expect, it } from "vitest";
import { bookConsignment } from "./book-consignment.js";
import { recordConsignmentEvent } from "./record-event.js";
import { inMemoryOrders, recordingPublisher, fixedClock, countingIds } from "./test-doubles.js";
import type { OrdersDeps } from "./ports.js";

const command = {
  tenantId: "01J8Z0T0000000000000000002",
  orderReference: "ORD-1001",
  originHubCode: "BLR1",
  destinationHubCode: "DEL3",
  service: "next_day",
  paymentMode: "cod" as const,
  codAmountMinor: 249900,
  codCurrency: "INR",
  proofRequirement: "photo_and_otp",
  attemptLimit: 3,
  packages: [{ weightGrams: 1200 }],
};

let deps: OrdersDeps & { publisher: ReturnType<typeof recordingPublisher> };

beforeEach(() => {
  deps = {
    repository: inMemoryOrders(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
  };
});

describe("booking a consignment", () => {
  it("creates the order and its consignment, and announces both", async () => {
    const consignment = await bookConsignment(deps, command);

    expect(consignment.status).toBe("booked");
    expect(deps.publisher.published.map((p) => p.event.type)).toEqual([
      "order.created",
      "consignment.booked",
    ]);
  });

  it("reuses an order that already exists rather than duplicating it", async () => {
    await bookConsignment(deps, command);
    deps.publisher.published.length = 0;

    await bookConsignment(deps, command);

    expect(deps.publisher.published.map((p) => p.event.type)).toEqual(["consignment.booked"]);
  });

  it("freezes the guards onto the consignment so a later rule change cannot alter it", async () => {
    const consignment = await bookConsignment(deps, command);

    expect(consignment.guards).toEqual({
      proofRequirement: "photo_and_otp",
      attemptLimit: 3,
      codAmountMinor: 249900,
      codCurrency: "INR",
    });
  });

  it("puts the cash amount on the event so downstream services need not ask", async () => {
    await bookConsignment(deps, command);
    const booked = deps.publisher.published[1];

    expect(booked?.payload).toMatchObject({
      payment_mode: "cod",
      cod_amount_minor: 249900,
      cod_currency: "INR",
    });
    expect(booked?.topic).toBe("consignment");
  });

  it("refuses a consignment the domain rejects, and announces nothing", async () => {
    await expect(bookConsignment(deps, { ...command, packages: [] })).rejects.toThrow();

    expect(deps.publisher.published).toHaveLength(0);
  });
});

describe("recording what happened to a consignment", () => {
  it("advances the consignment and announces the change", async () => {
    const booked = await bookConsignment(deps, command);
    deps.publisher.published.length = 0;

    const after = await recordConsignmentEvent(deps, {
      tenantId: command.tenantId,
      consignmentId: booked.id,
      event: { type: "picked_up" },
    });

    expect(after.status).toBe("picked_up");
    expect(deps.publisher.published[0]?.event.type).toBe("consignment.picked_up");
  });

  it("refuses a transition the state machine forbids, and changes nothing", async () => {
    const booked = await bookConsignment(deps, command);

    await expect(
      recordConsignmentEvent(deps, {
        tenantId: command.tenantId,
        consignmentId: booked.id,
        event: { type: "delivered", proofId: "p" },
      }),
    ).rejects.toThrow(/cannot be delivered/);

    const stored = await deps.repository.consignmentById(command.tenantId, booked.id);
    expect(stored?.consignment.status).toBe("booked");
  });

  it("reports a consignment that does not exist", async () => {
    await expect(
      recordConsignmentEvent(deps, {
        tenantId: command.tenantId,
        consignmentId: "01J8Z0T0000000000000000099",
        event: { type: "picked_up" },
      }),
    ).rejects.toThrow("no consignment with that identifier");
  });

  it("keeps one tenant from touching another's consignment", async () => {
    const booked = await bookConsignment(deps, command);

    await expect(
      recordConsignmentEvent(deps, {
        tenantId: "01J8Z0T0000000000000000099",
        consignmentId: booked.id,
        event: { type: "picked_up" },
      }),
    ).rejects.toThrow("no consignment with that identifier");
  });

  it("numbers the events in order so the stream can be replayed", async () => {
    const booked = await bookConsignment(deps, command);
    const at = { tenantId: command.tenantId, consignmentId: booked.id };

    await recordConsignmentEvent(deps, { ...at, event: { type: "picked_up" } });
    await recordConsignmentEvent(deps, { ...at, event: { type: "inscanned", hubId: "hub-1" } });

    const forConsignment = deps.publisher.published
      .filter((p) => p.event.aggregateId === booked.id)
      .map((p) => p.event.sequence);
    expect(forConsignment).toEqual([1, 2, 3]);
  });
});

describe("what each event carries downstream", () => {
  it("puts the reason and proof on a failed attempt", async () => {
    const booked = await bookConsignment(deps, command);
    const at = { tenantId: command.tenantId, consignmentId: booked.id };
    await recordConsignmentEvent(deps, { ...at, event: { type: "picked_up" } });
    await recordConsignmentEvent(deps, {
      ...at,
      event: { type: "out_for_delivery", runId: "run-1" },
    });
    deps.publisher.published.length = 0;

    await recordConsignmentEvent(deps, {
      ...at,
      event: { type: "attempted", ndrReason: "customer_unavailable", proofId: "proof-9" },
    });

    expect(deps.publisher.published[0]?.payload).toMatchObject({
      status: "attempted",
      ndr_reason: "customer_unavailable",
      proof_id: "proof-9",
    });
  });

  it("puts the hub on an inscan and the run on a dispatch", async () => {
    const booked = await bookConsignment(deps, command);
    const at = { tenantId: command.tenantId, consignmentId: booked.id };
    await recordConsignmentEvent(deps, { ...at, event: { type: "picked_up" } });
    deps.publisher.published.length = 0;

    await recordConsignmentEvent(deps, { ...at, event: { type: "inscanned", hubId: "hub-7" } });
    await recordConsignmentEvent(deps, {
      ...at,
      event: { type: "out_for_delivery", runId: "run-7" },
    });

    expect(deps.publisher.published[0]?.payload).toMatchObject({ hub_id: "hub-7" });
    expect(deps.publisher.published[1]?.payload).toMatchObject({ run_id: "run-7" });
  });

  it("carries the proof on a delivery and nothing extra on a plain pickup", async () => {
    const booked = await bookConsignment(deps, command);
    const at = { tenantId: command.tenantId, consignmentId: booked.id };
    deps.publisher.published.length = 0;
    await recordConsignmentEvent(deps, { ...at, event: { type: "picked_up" } });
    await recordConsignmentEvent(deps, {
      ...at,
      event: { type: "out_for_delivery", runId: "r" },
    });
    await recordConsignmentEvent(deps, {
      ...at,
      event: { type: "delivered", proofId: "proof-3", cashCollectedMinor: 249900 },
    });

    expect(deps.publisher.published[0]?.payload).toEqual({ status: "picked_up" });
    expect(deps.publisher.published[2]?.payload).toMatchObject({ proof_id: "proof-3" });
  });
});

describe("the return leg", () => {
  const toReturn = async (): Promise<{ tenantId: string; consignmentId: string }> => {
    const booked = await bookConsignment(deps, command);
    const at = { tenantId: command.tenantId, consignmentId: booked.id };
    await recordConsignmentEvent(deps, { ...at, event: { type: "picked_up" } });
    await recordConsignmentEvent(deps, { ...at, event: { type: "rto_initiated" } });
    return at;
  };

  it("carries the run on a return dispatch and the proof on a return delivery", async () => {
    const at = await toReturn();
    deps.publisher.published.length = 0;

    await recordConsignmentEvent(deps, {
      ...at,
      event: { type: "rto_out_for_delivery", runId: "run-rto" },
    });
    await recordConsignmentEvent(deps, {
      ...at,
      event: { type: "rto_delivered", proofId: "proof-rto" },
    });

    expect(deps.publisher.published[0]?.payload).toMatchObject({ run_id: "run-rto" });
    expect(deps.publisher.published[1]?.payload).toMatchObject({ proof_id: "proof-rto" });
  });

  it("carries the reason when a return attempt fails", async () => {
    const at = await toReturn();
    await recordConsignmentEvent(deps, {
      ...at,
      event: { type: "rto_out_for_delivery", runId: "run-rto" },
    });
    deps.publisher.published.length = 0;

    await recordConsignmentEvent(deps, {
      ...at,
      event: { type: "rto_attempted", ndrReason: "shipper_closed", proofId: "proof-x" },
    });

    expect(deps.publisher.published[0]?.payload).toMatchObject({
      ndr_reason: "shipper_closed",
      proof_id: "proof-x",
    });
  });

  it("carries the hub when a lost parcel is found", async () => {
    const booked = await bookConsignment(deps, command);
    const at = { tenantId: command.tenantId, consignmentId: booked.id };
    await recordConsignmentEvent(deps, { ...at, event: { type: "picked_up" } });
    await recordConsignmentEvent(deps, { ...at, event: { type: "lost" } });
    deps.publisher.published.length = 0;

    await recordConsignmentEvent(deps, { ...at, event: { type: "found", hubId: "hub-lost" } });

    expect(deps.publisher.published[0]?.payload).toMatchObject({ hub_id: "hub-lost" });
  });

  it("carries the reason when a pickup fails", async () => {
    const booked = await bookConsignment(deps, command);
    deps.publisher.published.length = 0;

    await recordConsignmentEvent(deps, {
      tenantId: command.tenantId,
      consignmentId: booked.id,
      event: { type: "pickup_attempted", ndrReason: "shipper_not_ready", proofId: "proof-p" },
    });

    expect(deps.publisher.published[0]?.payload).toMatchObject({
      ndr_reason: "shipper_not_ready",
    });
  });
});
