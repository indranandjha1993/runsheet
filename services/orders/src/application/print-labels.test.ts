import { beforeEach, describe, expect, it } from "vitest";
import { printLabels } from "./print-labels.js";
import { bookConsignment } from "./book-consignment.js";
import type { OrdersDeps } from "./ports.js";
import { countingIds, fixedClock, inMemoryOrders, recordingPublisher } from "./test-doubles.js";

let deps: OrdersDeps;
let references = 0;
const nextReference = (): number => {
  references += 1;
  return references;
};

beforeEach(() => {
  references = 0;
  deps = {
    repository: inMemoryOrders(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
  };
});

const routing = {
  origin: { hubCode: "BLR1", city: "Bengaluru" },
  destination: {
    hubCode: "DEL3",
    name: "Aarav Sharma",
    line: "Flat 402, Sunrise Apartments",
    city: "Noida",
    postcode: "201309",
  },
  sortCode: "DEL3-N-04",
  serviceLevel: "next_day" as const,
};

async function booked(packages = 1, paymentMode: "prepaid" | "cod" = "prepaid") {
  return bookConsignment(deps, {
    tenantId: "t",
    orderReference: `ORD-${String(nextReference())}`,
    originHubCode: "BLR1",
    destinationHubCode: "DEL3",
    service: "express",
    paymentMode,
    proofRequirement: "signature",
    attemptLimit: 3,
    packages: Array.from({ length: packages }, () => ({ weightGrams: 1250 })),
  });
}

describe("printing labels for a consignment", () => {
  it("gives one label per package", async () => {
    const consignment = await booked(3);

    const labels = await printLabels(deps, {
      tenantId: "t",
      consignmentId: consignment.id,
      ...routing,
    });

    expect(labels).toHaveLength(3);
    expect(labels.map((label) => label.pieceOf)).toEqual(["1 of 3", "2 of 3", "3 of 3"]);
  });

  it("gives every piece its own barcode", async () => {
    const consignment = await booked(3);

    const labels = await printLabels(deps, {
      tenantId: "t",
      consignmentId: consignment.id,
      ...routing,
    });

    expect(new Set(labels.map((label) => label.barcode)).size).toBe(3);
  });

  it("gives the same barcodes on a reprint, because the parcel is already labelled", async () => {
    const consignment = await booked(2);
    const command = { tenantId: "t", consignmentId: consignment.id, ...routing };

    const first = await printLabels(deps, command);
    const second = await printLabels(deps, command);

    expect(second.map((l) => l.barcode)).toEqual(first.map((l) => l.barcode));
  });

  it("gives different consignments different barcodes", async () => {
    const one = await booked(2);
    const two = await booked(2);

    const first = await printLabels(deps, { tenantId: "t", consignmentId: one.id, ...routing });
    const second = await printLabels(deps, { tenantId: "t", consignmentId: two.id, ...routing });

    const all = new Set([...first, ...second].map((label) => label.barcode));
    expect(all.size).toBe(4);
  });

  it("prints the amount to collect on a cash consignment", async () => {
    const consignment = await bookConsignment(deps, {
      tenantId: "t",
      orderReference: "ORD-4472",
      originHubCode: "BLR1",
      destinationHubCode: "DEL3",
      service: "express",
      paymentMode: "cod",
      proofRequirement: "signature",
      attemptLimit: 3,
      codAmountMinor: 149900,
      codCurrency: "INR",
      packages: [{ weightGrams: 1250 }],
    });

    const [label] = await printLabels(deps, {
      tenantId: "t",
      consignmentId: consignment.id,
      ...routing,
    });

    expect(label?.cod).toBe("1499.00 INR");
  });

  it("prints no amount on a prepaid consignment", async () => {
    const consignment = await booked(1);

    const [label] = await printLabels(deps, {
      tenantId: "t",
      consignmentId: consignment.id,
      ...routing,
    });

    expect(label?.cod).toBeUndefined();
  });

  it("prints the merchant's own order number, not an internal identifier", async () => {
    const consignment = await bookConsignment(deps, {
      tenantId: "t",
      orderReference: "ORD-9001",
      originHubCode: "BLR1",
      destinationHubCode: "DEL3",
      service: "express",
      paymentMode: "prepaid",
      proofRequirement: "signature",
      attemptLimit: 3,
      packages: [{ weightGrams: 1250 }],
    });

    const [label] = await printLabels(deps, {
      tenantId: "t",
      consignmentId: consignment.id,
      ...routing,
    });

    expect(label?.reference).toBe("ORD-9001");
  });

  it("refuses to label a consignment nobody booked", async () => {
    await expect(
      printLabels(deps, { tenantId: "t", consignmentId: "missing", ...routing }),
    ).rejects.toThrow("no consignment with that identifier");
  });

  it("refuses to label another tenant's consignment", async () => {
    const consignment = await booked(1);

    await expect(
      printLabels(deps, { tenantId: "other", consignmentId: consignment.id, ...routing }),
    ).rejects.toThrow("no consignment with that identifier");
  });
});
