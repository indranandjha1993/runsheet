import { describe, expect, it } from "vitest";
import { createTenant, type TenantInput } from "./tenant.js";

const valid: TenantInput = {
  id: "01J8Z0T0000000000000000002",
  name: "Bengaluru Couriers",
  countryCode: "IN",
  currency: "INR",
  locale: "en-IN",
  region: "ap-south",
};

describe("a tenant", () => {
  it("is created active with the details it needs to operate", () => {
    const tenant = createTenant(valid);

    expect(tenant.active).toBe(true);
    expect(tenant.currency).toBe("INR");
  });

  it("insists on a country, currency, and locale, because nothing works without them", () => {
    expect(() => createTenant({ ...valid, countryCode: "IND" })).toThrow(
      "countryCode must be a two-letter code",
    );
    expect(() => createTenant({ ...valid, currency: "rupees" })).toThrow(
      "currency must be a three-letter code",
    );
    expect(() => createTenant({ ...valid, locale: "" })).toThrow("locale is required");
  });

  it("refuses a blank name", () => {
    expect(() => createTenant({ ...valid, name: "  " })).toThrow("name is required");
  });

  it("refuses a region the platform does not run in", () => {
    expect(() => createTenant({ ...valid, region: "mars-1" })).toThrow("unknown region: mars-1");
  });

  it("supports the launch markets", () => {
    expect(createTenant({ ...valid, countryCode: "AE", currency: "AED", locale: "ar-AE" }).locale).toBe(
      "ar-AE",
    );
  });
});
