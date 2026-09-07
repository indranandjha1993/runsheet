import { describe, expect, it } from "vitest";
import { toZpl } from "./zpl.js";
import type { Label } from "../domain/label.js";

const label: Label = {
  barcode: "RS0000044719",
  reference: "ORD-4471",
  origin: "BLR1 Bengaluru",
  destinationHubCode: "DEL3",
  sortCode: "DEL3-N-04",
  serviceLevel: "next_day",
  address: ["Aarav Sharma", "Flat 402, Sunrise Apartments", "Noida 201309"],
  weight: "1.25 kg",
  pieceOf: "2 of 3",
  cod: "1499.00 INR",
};

describe("rendering a label for a thermal printer", () => {
  it("opens and closes one label", () => {
    const zpl = toZpl(label);

    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.trimEnd().endsWith("^XZ")).toBe(true);
  });

  it("encodes the barcode as code 128, which is what handhelds read", () => {
    expect(toZpl(label)).toContain("^BCN,");
    expect(toZpl(label)).toContain("^FDRS0000044719^FS");
  });

  it("prints the sort code large, because it is read across a hub", () => {
    expect(toZpl(label)).toMatch(/\^A0N,(1[0-9]{2}|[89][0-9])[^\n]*\^FDDEL3-N-04/);
  });

  it("prints every address line", () => {
    const zpl = toZpl(label);

    for (const line of label.address) expect(zpl).toContain(line);
  });

  it("prints the amount to collect when there is one", () => {
    expect(toZpl(label)).toContain("COD 1499.00 INR");
  });

  it("prints nothing about cash when there is none", () => {
    expect(toZpl({ ...label, cod: undefined })).not.toContain("COD");
  });

  it("escapes a caret in an address so it cannot become a command", () => {
    const zpl = toZpl({ ...label, address: ["Flat ^ 2", "Noida 201309"] });

    expect(zpl).toContain("Flat _5e 2");
    expect(zpl).not.toContain("Flat ^ 2");
  });

  it("escapes a tilde too, because it is the other control character", () => {
    expect(toZpl({ ...label, address: ["A~B"] })).toContain("A_7eB");
  });
})
