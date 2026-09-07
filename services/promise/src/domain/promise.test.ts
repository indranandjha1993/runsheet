import { describe, expect, it } from "vitest";
import { makePromise, publicView, updateEta, type Promise as DeliveryPromise } from "./promise.js";

const at = new Date("2026-09-07T10:00:00.000Z");

const promised = (): DeliveryPromise =>
  makePromise({
    consignmentId: "c-1",
    tenantId: "t-1",
    windowStart: new Date("2026-09-07T14:00:00.000Z"),
    windowEnd: new Date("2026-09-07T16:00:00.000Z"),
    at,
  });

describe("promising a delivery window", () => {
  it("holds the window it promised", () => {
    expect(promised().windowStart).toEqual(new Date("2026-09-07T14:00:00.000Z"));
  });

  it("refuses a window that ends before it starts", () => {
    expect(() =>
      makePromise({
        consignmentId: "c",
        tenantId: "t",
        windowStart: new Date("2026-09-07T16:00:00.000Z"),
        windowEnd: new Date("2026-09-07T14:00:00.000Z"),
        at,
      }),
    ).toThrow("a delivery window must end after it starts");
  });

  it("refuses a window that has already passed", () => {
    expect(() =>
      makePromise({
        consignmentId: "c",
        tenantId: "t",
        windowStart: new Date("2026-09-06T14:00:00.000Z"),
        windowEnd: new Date("2026-09-06T16:00:00.000Z"),
        at,
      }),
    ).toThrow("a delivery window cannot be in the past");
  });
});

describe("updating the estimate", () => {
  it("keeps an estimate inside the window without alarming anyone", () => {
    const updated = updateEta(promised(), {
      eta: new Date("2026-09-07T15:00:00.000Z"),
      at,
    });

    expect(updated.atRisk).toBe(false);
    expect(updated.notifiable).toBe(false);
  });

  it("flags an estimate past the window and says the customer should be told", () => {
    const updated = updateEta(promised(), {
      eta: new Date("2026-09-07T17:00:00.000Z"),
      at,
    });

    expect(updated.atRisk).toBe(true);
    expect(updated.notifiable).toBe(true);
  });

  it("does not pester the customer when the estimate barely moves", () => {
    const once = updateEta(promised(), { eta: new Date("2026-09-07T17:00:00.000Z"), at });
    const again = updateEta(once, { eta: new Date("2026-09-07T17:05:00.000Z"), at });

    expect(again.notifiable).toBe(false);
  });

  it("tells the customer again when the estimate moves materially", () => {
    const once = updateEta(promised(), { eta: new Date("2026-09-07T17:00:00.000Z"), at });
    const again = updateEta(once, { eta: new Date("2026-09-07T19:00:00.000Z"), at });

    expect(again.notifiable).toBe(true);
  });

  it("tells the customer when a late delivery comes back on time", () => {
    const late = updateEta(promised(), { eta: new Date("2026-09-07T17:00:00.000Z"), at });
    const recovered = updateEta(late, { eta: new Date("2026-09-07T15:00:00.000Z"), at });

    expect(recovered.atRisk).toBe(false);
    expect(recovered.notifiable).toBe(true);
  });

  it("stops promising anything once the consignment is settled", () => {
    const delivered = updateEta(
      { ...promised(), settled: true },
      { eta: new Date("2026-09-07T19:00:00.000Z"), at },
    );

    expect(delivered.notifiable).toBe(false);
  });
});

describe("what the consignee is shown", () => {
  it("shows the status, the window, and the estimate", () => {
    const view = publicView(
      updateEta(promised(), { eta: new Date("2026-09-07T15:00:00.000Z"), at }),
    );

    expect(view).toMatchObject({
      status: "on_track",
      windowStart: "2026-09-07T14:00:00.000Z",
      estimatedArrival: "2026-09-07T15:00:00.000Z",
    });
  });

  it("shows nothing that identifies anybody", () => {
    const view = publicView(promised());

    expect(Object.keys(view)).toEqual([
      "status",
      "windowStart",
      "windowEnd",
      "estimatedArrival",
      "lastMilestone",
    ]);
  });

  it("says it is running late rather than hiding it", () => {
    const late = updateEta(promised(), { eta: new Date("2026-09-07T18:00:00.000Z"), at });

    expect(publicView(late).status).toBe("running_late");
  });

  it("says when it is done", () => {
    expect(publicView({ ...promised(), settled: true, lastMilestone: "delivered" }).status).toBe(
      "delivered",
    );
  });
});
