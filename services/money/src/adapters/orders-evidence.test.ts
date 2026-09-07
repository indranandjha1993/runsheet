import { describe, expect, it, vi } from "vitest";
import { ordersEvidence } from "./orders-evidence.js";

function respondingWith(status: number, body: unknown): typeof globalThis.fetch {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
  return vi.fn(() => Promise.resolve(response.clone()));
}

const delivered = {
  paymentMode: "cod",
  status: "delivered",
  service: "express",
  originHubCode: "BLR1",
  destinationHubCode: "DEL3",
  deliveredAt: "2026-09-09T11:00:00.000Z",
  packages: [{ weightGrams: 800 }, { weightGrams: 400 }],
};

const source = (call: typeof globalThis.fetch, credential = "rsk_money") =>
  ordersEvidence({ ordersUrl: "http://orders", credential, fetch: call });

describe("asking orders what happened to a consignment", () => {
  it("adds up what was actually shipped", async () => {
    const evidence = await source(respondingWith(200, delivered)).forConsignment("t", "c-1");

    expect(evidence?.shippedWeightGrams).toBe(1200);
  });

  it("carries the lane and the service, which is what the rate card is priced on", async () => {
    const evidence = await source(respondingWith(200, delivered)).forConsignment("t", "c-1");

    expect(evidence).toMatchObject({ origin: "BLR1", destination: "DEL3", service: "express" });
  });

  it("takes the delivery time orders recorded, not the time it was asked", async () => {
    const evidence = await source(respondingWith(200, delivered)).forConsignment("t", "c-1");

    expect(evidence?.deliveredAt?.toISOString()).toBe("2026-09-09T11:00:00.000Z");
  });

  it("says the proof stands only once the parcel was delivered", async () => {
    const undelivered = { ...delivered, status: "out_for_delivery", deliveredAt: undefined };
    const evidence = await source(respondingWith(200, undelivered)).forConsignment("t", "c-1");

    expect(evidence?.proofSatisfiesRequirement).toBe(false);
    expect(evidence?.deliveredAt).toBeUndefined();
  });

  it("has no evidence for a consignment it cannot see, rather than assuming", async () => {
    expect(await source(respondingWith(404, {})).forConsignment("t", "c-1")).toBeUndefined();
  });

  it("has no evidence when orders answers with something it cannot read", async () => {
    expect(
      await source(respondingWith(200, { nonsense: true })).forConsignment("t", "c-1"),
    ).toBeUndefined();
  });

  it("presents its own credential, never the caller's", async () => {
    const call = respondingWith(200, delivered);

    await source(call).forConsignment("t", "c-1");

    const sent = vi.mocked(call).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(sent["authorization"]).toBe("Bearer rsk_money");
  });

  it("says which tenant it is asking on behalf of", async () => {
    const call = respondingWith(200, delivered);

    await source(call).forConsignment("tenant-42", "c-1");

    const sent = vi.mocked(call).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(sent["x-on-behalf-of-tenant"]).toBe("tenant-42");
  });

  it("leaves the price to the rate card rather than inventing one", async () => {
    const evidence = await source(respondingWith(200, delivered)).forConsignment("t", "c-1");

    expect(evidence?.expectedMinor).toBe(0);
  });
});
