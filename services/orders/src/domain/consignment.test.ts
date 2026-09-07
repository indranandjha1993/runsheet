import { describe, expect, it } from "vitest";
import {
  apply,
  book,
  can,
  mustReturn,
  type BookCommand,
  type Consignment,
  type ConsignmentEvent,
} from "./consignment.js";

const guards = {
  proofRequirement: "photo_and_otp",
  attemptLimit: 3,
  codAmountMinor: 249900,
  codCurrency: "INR",
};

const bookable: BookCommand = {
  id: "01J8Z0T0000000000000000001",
  tenantId: "01J8Z0T0000000000000000002",
  orderId: "01J8Z0T0000000000000000003",
  originHubCode: "BLR1",
  destinationHubCode: "DEL3",
  service: "next_day",
  paymentMode: "cod",
  guards,
  packages: [{ id: "pkg-1", weightGrams: 1200 }],
};

const booked = (): Consignment => book(bookable);

function walk(from: Consignment, events: ConsignmentEvent[]): Consignment {
  return events.reduce(apply, from);
}

describe("booking a consignment", () => {
  it("starts in booked with its guards frozen onto it", () => {
    const consignment = booked();

    expect(consignment.status).toBe("booked");
    expect(consignment.guards.attemptLimit).toBe(3);
    expect(consignment.attemptCount).toBe(0);
  });

  it("requires an amount and a currency when payment is on delivery", () => {
    expect(() =>
      book({
        id: "c",
        tenantId: "t",
        orderId: "o",
        originHubCode: "BLR1",
        destinationHubCode: "DEL3",
        service: "next_day",
        paymentMode: "cod",
        guards: { proofRequirement: "photo", attemptLimit: 3 },
        packages: [{ id: "p", weightGrams: 1 }],
      }),
    ).toThrow("cash on delivery needs an amount and a currency");
  });

  it("refuses a consignment with no packages", () => {
    expect(() =>
      book({
        id: "c",
        tenantId: "t",
        orderId: "o",
        originHubCode: "BLR1",
        destinationHubCode: "DEL3",
        service: "next_day",
        paymentMode: "prepaid",
        guards: { proofRequirement: "photo", attemptLimit: 3 },
        packages: [],
      }),
    ).toThrow("a consignment needs at least one package");
  });
});

describe("guards frozen at booking", () => {
  it("refuses an attempt limit below one, which would return everything immediately", () => {
    expect(() =>
      book({
        id: "c",
        tenantId: "t",
        orderId: "o",
        originHubCode: "BLR1",
        destinationHubCode: "DEL3",
        service: "next_day",
        paymentMode: "prepaid",
        guards: { proofRequirement: "photo", attemptLimit: 0 },
        packages: [{ id: "p", weightGrams: 1 }],
      }),
    ).toThrow("the attempt limit must be at least one");
  });

  it("refuses cash that differs from the amount due by more than the tolerance", () => {
    const out = walk(booked(), [{ type: "picked_up" }, { type: "out_for_delivery", runId: "r" }]);

    expect(() =>
      apply(out, { type: "delivered", proofId: "p", cashCollectedMinor: 200000 }),
    ).toThrow(/differs from the amount due/);
  });

  it("accepts a shortfall inside the tenant's tolerance", () => {
    const lenient = apply(
      apply(
        book({
          id: "c",
          tenantId: "t",
          orderId: "o",
          originHubCode: "BLR1",
          destinationHubCode: "DEL3",
          service: "next_day",
          paymentMode: "cod",
          guards: { ...guards, codToleranceMinor: 500 },
          packages: [{ id: "p", weightGrams: 1 }],
        }),
        { type: "picked_up" },
      ),
      { type: "out_for_delivery", runId: "r" },
    );

    expect(
      apply(lenient, { type: "delivered", proofId: "p", cashCollectedMinor: 249500 }).status,
    ).toBe("delivered");
  });
});

describe("prepaid consignments", () => {
  it("delivers without any cash, because none is due", () => {
    const prepaid = walk(
      book({
        id: "c",
        tenantId: "t",
        orderId: "o",
        originHubCode: "BLR1",
        destinationHubCode: "DEL3",
        service: "next_day",
        paymentMode: "prepaid",
        guards: { proofRequirement: "photo", attemptLimit: 3 },
        packages: [{ id: "p", weightGrams: 1 }],
      }),
      [{ type: "picked_up" }, { type: "out_for_delivery", runId: "r" }],
    );

    expect(apply(prepaid, { type: "delivered", proofId: "p" }).status).toBe("delivered");
  });
});

describe("the middle mile", () => {
  it("moves between hubs and back into a hub", () => {
    const end = walk(booked(), [
      { type: "picked_up" },
      { type: "inscanned", hubId: "hub-1" },
      { type: "departed_hub" },
      { type: "inscanned", hubId: "hub-2" },
    ]);

    expect(end.status).toBe("in_hub");
    expect(end.currentHubId).toBe("hub-2");
  });
});

describe("cancellation before pickup", () => {
  it("cancels a consignment nobody has collected yet", () => {
    expect(apply(booked(), { type: "cancelled" }).status).toBe("cancelled");
  });
});

describe("the forward journey", () => {
  it("moves from booked to delivered through the usual path", () => {
    const end = walk(booked(), [
      { type: "picked_up" },
      { type: "inscanned", hubId: "hub-1" },
      { type: "out_for_delivery", runId: "run-1" },
      { type: "delivered", proofId: "proof-1", cashCollectedMinor: 249900 },
    ]);

    expect(end.status).toBe("delivered");
  });

  it("allows a direct delivery with no hub in between, as hyperlocal runs do", () => {
    const end = walk(booked(), [{ type: "picked_up" }, { type: "out_for_delivery", runId: "r" }]);

    expect(end.status).toBe("out_for_delivery");
  });

  it("records a failed pickup and returns to booked so it can be retried", () => {
    const end = walk(booked(), [
      { type: "pickup_attempted", ndrReason: "shipper_not_ready", proofId: "p" },
    ]);

    expect(end.status).toBe("booked");
    expect(end.pickupAttempts).toBe(1);
  });
});

describe("failed delivery attempts", () => {
  const outForDelivery = (): Consignment =>
    walk(booked(), [{ type: "picked_up" }, { type: "out_for_delivery", runId: "run-1" }]);

  it("records the attempt but leaves the parcel on the van until a hub scans it back", () => {
    const attempted = walk(outForDelivery(), [
      { type: "attempted", ndrReason: "customer_unavailable", proofId: "p" },
    ]);

    expect(attempted.status).toBe("attempted");
    expect(attempted.attemptCount).toBe(1);
    expect(apply(attempted, { type: "inscanned", hubId: "hub-1" }).status).toBe("in_hub");
  });

  it("allows a same-day retry straight from an attempt, without a hub in between", () => {
    const attempted = walk(outForDelivery(), [
      { type: "attempted", ndrReason: "customer_called_back", proofId: "p" },
    ]);

    expect(apply(attempted, { type: "out_for_delivery", runId: "run-2" }).status).toBe(
      "out_for_delivery",
    );
  });

  it("says a return is due once the attempt limit is spent", () => {
    let current = outForDelivery();
    for (let i = 0; i < 3; i += 1) {
      current = apply(current, {
        type: "attempted",
        ndrReason: "customer_unavailable",
        proofId: "p",
      });
      expect(mustReturn(current)).toBe(i === 2);
      if (i < 2) current = apply(current, { type: "out_for_delivery", runId: "run-1" });
    }

    expect(current.attemptCount).toBe(3);
    expect(apply(current, { type: "rto_initiated" }).status).toBe("rto_initiated");
  });

  it("says a return is due immediately when a cancellation arrived late", () => {
    const attempted = walk(outForDelivery(), [
      { type: "cancel_requested" },
      { type: "attempted", ndrReason: "customer_unavailable", proofId: "p" },
    ]);

    expect(mustReturn(attempted)).toBe(true);
  });
});

describe("what the rules forbid", () => {
  it("will not deliver something never picked up", () => {
    expect(can(booked(), { type: "delivered", proofId: "p" })).toBe(false);
  });

  it("will not cancel after pickup, because that is a return", () => {
    const picked = walk(booked(), [{ type: "picked_up" }]);

    expect(can(picked, { type: "cancelled" })).toBe(false);
    expect(can(booked(), { type: "cancelled" })).toBe(true);
  });

  it("will not deliver cash on delivery without the money", () => {
    const out = walk(booked(), [{ type: "picked_up" }, { type: "out_for_delivery", runId: "r" }]);

    expect(() => apply(out, { type: "delivered", proofId: "p" })).toThrow(
      "cash on delivery must be collected before delivery",
    );
  });

  it("accepts cash within the tenant's tolerance", () => {
    const out = walk(booked(), [{ type: "picked_up" }, { type: "out_for_delivery", runId: "r" }]);

    const end = apply(out, { type: "delivered", proofId: "p", cashCollectedMinor: 249900 });

    expect(end.status).toBe("delivered");
  });

  it("will not attempt delivery without a reason and a proof record", () => {
    const out = walk(booked(), [{ type: "picked_up" }, { type: "out_for_delivery", runId: "r" }]);

    expect(() => apply(out, { type: "attempted", ndrReason: "", proofId: "p" })).toThrow(
      "a failed attempt needs a reason",
    );
  });

  it("says clearly which transition was refused", () => {
    expect(() => apply(booked(), { type: "delivered", proofId: "p" })).toThrow(
      "a consignment that is booked cannot be delivered",
    );
  });
});

describe("returns", () => {
  it("carries a return through a hub, as a real return leg does", () => {
    const end = walk(booked(), [
      { type: "picked_up" },
      { type: "out_for_delivery", runId: "r" },
      { type: "attempted", ndrReason: "address_not_found", proofId: "p" },
      { type: "rto_initiated" },
      { type: "rto_out_for_delivery", runId: "r2" },
      { type: "rto_delivered", proofId: "p2" },
    ]);

    expect(end.status).toBe("rto_delivered");
  });

  it("will not return something already delivered", () => {
    const delivered = walk(booked(), [
      { type: "picked_up" },
      { type: "out_for_delivery", runId: "r" },
      { type: "delivered", proofId: "p", cashCollectedMinor: 249900 },
    ]);

    expect(can(delivered, { type: "rto_initiated" })).toBe(false);
  });
});

describe("things that go wrong in the field", () => {
  it("treats damage as a flag, because a damaged parcel is still delivered or returned", () => {
    const out = walk(booked(), [{ type: "picked_up" }, { type: "out_for_delivery", runId: "r" }]);

    const end = walk(out, [
      { type: "damaged", note: "crushed corner" },
      { type: "delivered", proofId: "p", cashCollectedMinor: 249900 },
    ]);

    expect(end.damaged).toBe(true);
    expect(end.status).toBe("delivered");
  });

  it("lets a lost parcel be found and rejoin the network", () => {
    const end = walk(booked(), [
      { type: "picked_up" },
      { type: "lost" },
      { type: "found", hubId: "hub-1" },
    ]);

    expect(end.status).toBe("in_hub");
  });

  it("turns a cancellation requested while the driver was offline into a return", () => {
    const out = walk(booked(), [{ type: "picked_up" }, { type: "out_for_delivery", runId: "r" }]);

    const end = walk(out, [{ type: "cancel_requested" }, { type: "rto_initiated" }]);

    expect(end.status).toBe("rto_initiated");
    expect(end.cancelRequested).toBe(true);
  });

  it("puts a return attempt back into the return flow", () => {
    const end = walk(booked(), [
      { type: "picked_up" },
      { type: "rto_initiated" },
      { type: "rto_out_for_delivery", runId: "r" },
      { type: "rto_attempted", ndrReason: "shipper_closed", proofId: "p" },
      { type: "rto_out_for_delivery", runId: "r2" },
      { type: "rto_delivered", proofId: "p2" },
    ]);

    expect(end.status).toBe("rto_delivered");
  });
});

describe("what a consignment knows about where it is going", () => {
  it("carries its origin and destination hubs from the moment it is booked", () => {
    const booked = book(bookable);

    expect(booked.originHubCode).toBe("BLR1");
    expect(booked.destinationHubCode).toBe("DEL3");
  });

  it("refuses a booking with no lane, because it could not be priced or planned", () => {
    expect(() => book({ ...bookable, originHubCode: "" })).toThrow(
      "a consignment needs an origin and a destination hub",
    );
    expect(() => book({ ...bookable, destinationHubCode: "" })).toThrow(
      "a consignment needs an origin and a destination hub",
    );
  });

  it("refuses a lane that goes nowhere", () => {
    expect(() => book({ ...bookable, destinationHubCode: "BLR1" })).toThrow(
      "a consignment cannot be delivered to the hub it starts from",
    );
  });
});
