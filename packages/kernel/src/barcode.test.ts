import { describe, expect, it } from "vitest";
import { barcodeFor, isValidBarcode } from "./barcode.js";

describe("the barcode on a label", () => {
  it("is our prefix, the serial, and a check digit", () => {
    expect(barcodeFor(4471)).toMatch(/^RS[0-9]{10}$/);
  });

  it("gives the same serial the same barcode every time", () => {
    expect(barcodeFor(4471)).toBe(barcodeFor(4471));
  });

  it("gives different serials different barcodes", () => {
    expect(barcodeFor(4471)).not.toBe(barcodeFor(4472));
  });

  it("catches a single wrong digit, which is what a bad scan looks like", () => {
    const good = barcodeFor(4471);
    const wrong = `${good.slice(0, 6)}${good[6] === "0" ? "1" : "0"}${good.slice(7)}`;

    expect(isValidBarcode(good)).toBe(true);
    expect(isValidBarcode(wrong)).toBe(false);
  });

  it("catches two adjacent digits swapped, which is what a typed entry looks like", () => {
    const good = barcodeFor(987654);
    const swapped = `${good.slice(0, 5)}${good[6] ?? ""}${good[5] ?? ""}${good.slice(7)}`;

    expect(swapped).not.toBe(good);
    expect(isValidBarcode(swapped)).toBe(false);
  });

  it("rejects anything that is not our format", () => {
    expect(isValidBarcode("1234567890")).toBe(false);
    expect(isValidBarcode("RS123")).toBe(false);
    expect(isValidBarcode("rs0000004471")).toBe(false);
  });

  it("refuses a serial that will not fit, rather than wrapping round to an existing one", () => {
    expect(() => barcodeFor(1_000_000_000)).toThrow("serial is too large for a barcode");
    expect(() => barcodeFor(0)).toThrow("serial must be positive");
  });
});
