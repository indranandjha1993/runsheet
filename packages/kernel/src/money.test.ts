import { describe, expect, it } from "vitest";
import { money } from "./money.js";

describe("Money", () => {
  it("holds an amount in minor units with its currency", () => {
    const amount = money(1250, "INR");

    expect(amount.minorUnits).toBe(1250);
    expect(amount.currency).toBe("INR");
    expect(amount.toString()).toBe("12.50 INR");
  });

  it("adds and subtracts amounts of the same currency", () => {
    const collected = money(1250, "INR");

    expect(collected.plus(money(750, "INR")).minorUnits).toBe(2000);
    expect(collected.minus(money(250, "INR")).minorUnits).toBe(1000);
  });

  it("refuses to mix currencies", () => {
    expect(() => money(100, "INR").plus(money(100, "AED"))).toThrow("cannot combine INR and AED");
  });

  it("compares amounts so a cash variance can be judged", () => {
    const expected = money(5000, "INR");

    expect(expected.equals(money(5000, "INR"))).toBe(true);
    expect(expected.isGreaterThan(money(4999, "INR"))).toBe(true);
    expect(expected.equals(money(5000, "AED"))).toBe(false);
  });

  it("keeps negative amounts, because a shortage is a real value", () => {
    expect(money(1000, "INR").minus(money(1500, "INR")).minorUnits).toBe(-500);
  });

  it("rejects fractional minor units and unknown currency codes", () => {
    expect(() => money(10.5, "INR")).toThrow("amount must be whole minor units");
    expect(() => money(100, "rupees")).toThrow("currency must be a three-letter code");
  });
});
