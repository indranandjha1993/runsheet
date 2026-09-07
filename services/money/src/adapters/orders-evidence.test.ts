import { describe, expect, it, vi } from "vitest";
import { ordersEvidence } from "./orders-evidence.js";

function respondingWith(status: number, body: unknown): typeof globalThis.fetch {
  const response = new Response(JSON.stringify(body), { status });
  return vi.fn(() => Promise.resolve(response.clone()));
}

const delivered = {
  paymentMode: "cod",
  status: "delivered",
  packages: [{ weightGrams: 800 }, { weightGrams: 400 }],
};

describe("asking orders what happened to a consignment", () => {
  it("adds up what was actually shipped", async () => {
    const source = ordersEvidence({
      ordersUrl: "http://orders",
      credential: "rsk_x",
      fetch: respondingWith(200, delivered),
    });

    const evidence = await source.forConsignment("t", "c-1");

    expect(evidence?.shippedWeightGrams).toBe(1200);
  });

  it("says the proof stands only once the parcel was delivered", async () => {
    const source = ordersEvidence({
      ordersUrl: "http://orders",
      credential: "rsk_x",
      fetch: respondingWith(200, { ...delivered, status: "out_for_delivery" }),
    });

    const evidence = await source.forConsignment("t", "c-1");

    expect(evidence?.proofSatisfiesRequirement).toBe(false);
    expect(evidence?.deliveredAt).toBeUndefined();
  });

  it("has no evidence for a consignment it cannot see, rather than assuming", async () => {
    const source = ordersEvidence({
      ordersUrl: "http://orders",
      credential: "rsk_x",
      fetch: respondingWith(404, {}),
    });

    expect(await source.forConsignment("t", "c-1")).toBeUndefined();
  });

  it("presents its own credential, never the caller's", async () => {
    const call = respondingWith(200, delivered);
    const source = ordersEvidence({
      ordersUrl: "http://orders",
      credential: "rsk_money",
      fetch: call,
    });

    await source.forConsignment("t", "c-1");

    const sent = vi.mocked(call).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(sent["authorization"]).toBe("Bearer rsk_money");
  });
});
