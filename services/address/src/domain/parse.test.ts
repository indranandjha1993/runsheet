import { describe, expect, it } from "vitest";
import { parseAddress } from "./parse.js";

describe("parsing an Indian address", () => {
  it("pulls out a postcode wherever it sits in the text", () => {
    expect(parseAddress("42 MG Road, Bengaluru 560001", "IN").postcode).toBe("560001");
    expect(parseAddress("560001, MG Road", "IN").postcode).toBe("560001");
  });

  it("ignores a six-digit number that is not a postcode", () => {
    expect(parseAddress("Flat 100200, MG Road, Bengaluru", "IN").postcode).toBeUndefined();
  });

  it("recognises a landmark, which is how people actually navigate here", () => {
    const parsed = parseAddress("2nd Cross, near Sai Temple, Indiranagar, 560038", "IN");

    expect(parsed.landmark).toBe("Sai Temple");
  });

  it("recognises the other ways a landmark is written", () => {
    expect(parseAddress("opposite City Hospital, Pune", "IN").landmark).toBe("City Hospital");
    expect(parseAddress("behind Central Mall, Pune", "IN").landmark).toBe("Central Mall");
    expect(parseAddress("beside Ganesh Temple, Pune", "IN").landmark).toBe("Ganesh Temple");
  });

  it("pulls out a flat or house number", () => {
    expect(parseAddress("Flat 4B, Sunrise Apartments, Pune 411001", "IN").unit).toBe("4B");
    expect(parseAddress("#12, 5th Main, Bengaluru", "IN").unit).toBe("12");
  });

  it("keeps the original text exactly as it was given", () => {
    const raw = "  Flat 4B,  Sunrise   Apartments,  Pune 411001 ";

    expect(parseAddress(raw, "IN").raw).toBe(raw);
  });

  it("scores an address with a postcode and a landmark higher than a bare line", () => {
    const rich = parseAddress("Flat 4B, near Sai Temple, Indiranagar, Bengaluru 560038", "IN");
    const bare = parseAddress("somewhere in Bengaluru", "IN");

    expect(rich.completeness).toBeGreaterThan(bare.completeness);
    expect(bare.completeness).toBeLessThan(0.5);
  });
});

describe("parsing an Emirati address", () => {
  it("recognises a makani number, which is the Dubai equivalent of a postcode", () => {
    expect(parseAddress("Villa 12, Al Barsha, Makani 30470 71308", "AE").makani).toBe(
      "30470 71308",
    );
  });

  it("does not look for an Indian postcode there", () => {
    expect(parseAddress("Villa 12, Al Barsha 560001", "AE").postcode).toBeUndefined();
  });

  it("still recognises landmarks", () => {
    expect(parseAddress("near Mall of the Emirates, Al Barsha", "AE").landmark).toBe(
      "Mall of the Emirates",
    );
  });
});

describe("parsing anywhere else", () => {
  it("falls back to keeping the text and scoring it low", () => {
    const parsed = parseAddress("221B Baker Street, London", "GB");

    expect(parsed.raw).toBe("221B Baker Street, London");
    expect(parsed.completeness).toBeLessThan(0.5);
  });

  it("refuses empty text rather than storing a blank address", () => {
    expect(() => parseAddress("   ", "IN")).toThrow("an address needs some text");
  });
});
