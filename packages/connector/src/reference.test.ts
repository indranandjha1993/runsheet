import { describe, expect, it } from "vitest";
import { referenceCarrier } from "./reference.js";
import { assertConnector } from "./contract.js";
import { runCall } from "./runner.js";
import type { Connector, Result } from "./contract.js";

const context = {
  tenantId: "t",
  credentials: { api_key: "test-key" },
  idempotencyKey: "idem-1",
};

const place = { line: "1 Road", city: "Bengaluru", postcode: "560001", countryCode: "IN" };
const quoteRequest = { origin: place, destination: place, parcels: [{ weightGrams: 1200 }] };
const bookRequest = { ...quoteRequest, reference: "ORD-1", service: "standard" };
const once = { attempts: 1 };

const call = <T>(
  carrier: Connector,
  operation: "quote" | "book" | "track" | "cancel",
  request: unknown,
  options: Record<string, unknown> = {},
): Promise<Result<T>> =>
  runCall<T>(carrier, operation, { context, request, options: { ...once, ...options } });

async function bookedReference(carrier: Connector): Promise<string> {
  const booked = await call<{ carrierReference: string }>(carrier, "book", bookRequest);
  if (booked.outcome !== "ok") throw new Error("the reference carrier would not book");
  return booked.value.carrierReference;
}

describe("the reference connector", () => {
  it("meets the contract, which is the point of it", () => {
    expect(() => {
      assertConnector(referenceCarrier());
    }).not.toThrow();
  });

  it("quotes every service it runs, priced by weight", async () => {
    const result = await call<{ service: string; amountMinor: number }[]>(
      referenceCarrier(),
      "quote",
      quoteRequest,
    );

    if (result.outcome !== "ok") throw new Error("the reference carrier would not quote");
    expect(result.value.map((quote) => quote.service)).toEqual(["standard", "express"]);
  });

  it("charges more for a heavier parcel", async () => {
    const light = await call<{ amountMinor: number }[]>(referenceCarrier(), "quote", quoteRequest);
    const heavy = await call<{ amountMinor: number }[]>(referenceCarrier(), "quote", {
      ...quoteRequest,
      parcels: [{ weightGrams: 5000 }],
    });

    if (light.outcome !== "ok" || heavy.outcome !== "ok") throw new Error("no quote");
    expect(heavy.value[0]?.amountMinor).toBeGreaterThan(light.value[0]?.amountMinor ?? 0);
  });

  it("books and gives back a reference the platform can track on", async () => {
    expect(await bookedReference(referenceCarrier())).toMatch(/^REF\d{8}$/);
  });

  it("gives the same booking back for the same idempotency key", async () => {
    const carrier = referenceCarrier();

    expect(await bookedReference(carrier)).toBe(await bookedReference(carrier));
  });

  it("refuses a service it does not run", async () => {
    const result = await call(referenceCarrier(), "book", {
      ...bookRequest,
      service: "teleport",
    });

    expect(result).toMatchObject({ outcome: "failed", kind: "rejected" });
  });

  it("refuses a call with no credential rather than pretending", async () => {
    const result = await runCall(referenceCarrier(), "quote", {
      context: { ...context, credentials: {} },
      request: quoteRequest,
      options: once,
    });

    expect(result).toMatchObject({ outcome: "failed", kind: "misconfigured" });
  });

  it("says it has never heard of a reference it did not issue", async () => {
    const result = await call(referenceCarrier(), "track", { carrierReference: "nothing" });

    expect(result).toMatchObject({ outcome: "failed", kind: "not_found" });
  });

  it("tracks something it booked", async () => {
    const carrier = referenceCarrier();
    const carrierReference = await bookedReference(carrier);

    expect(await call(carrier, "track", { carrierReference })).toMatchObject({ outcome: "ok" });
  });

  it("cancels something it booked, and only once", async () => {
    const carrier = referenceCarrier();
    const carrierReference = await bookedReference(carrier);

    expect(await call(carrier, "cancel", { carrierReference })).toMatchObject({ outcome: "ok" });
    expect(await call(carrier, "cancel", { carrierReference })).toMatchObject({
      outcome: "failed",
      kind: "rejected",
    });
  });

  it("shows a cancelled shipment as cancelled when it is tracked", async () => {
    const carrier = referenceCarrier();
    const carrierReference = await bookedReference(carrier);
    await call(carrier, "cancel", { carrierReference });

    const tracked = await call<{ status: string }>(carrier, "track", { carrierReference });

    if (tracked.outcome !== "ok") throw new Error("could not track");
    expect(tracked.value.status).toBe("cancelled");
  });
});
