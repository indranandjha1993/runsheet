import { describe, expect, it } from "vitest";
import { addressOf, describeConfig, gatewayConfig } from "./config.js";

describe("gateway configuration", () => {
  it("runs on the documented port and rate with nothing configured", () => {
    const config = gatewayConfig({});

    expect(config.PORT_GATEWAY).toBe(14000);
    expect(config.RATE_LIMIT_PER_MINUTE).toBe(600);
  });

  it("knows where every service lives by default", () => {
    const config = gatewayConfig({});

    for (const name of [
      "identity",
      "network",
      "address",
      "orders",
      "execution",
      "planning",
      "promise",
      "exceptions",
      "money",
      "policy",
    ]) {
      expect(addressOf(config, name)).toContain("http://localhost:");
    }
  });

  it("knows nothing about a service that does not exist", () => {
    expect(addressOf(gatewayConfig({}), "warehouse")).toBeUndefined();
  });

  it("takes an address from the environment when one is given", () => {
    const config = gatewayConfig({ ORDERS_URL: "http://orders.internal:8080" });

    expect(addressOf(config, "orders")).toBe("http://orders.internal:8080");
  });

  it("rejects a rate that is not a number", () => {
    expect(() => gatewayConfig({ RATE_LIMIT_PER_MINUTE: "fast" })).toThrow(
      /RATE_LIMIT_PER_MINUTE/,
    );
  });

  it("masks the service addresses when describing itself for the log", () => {
    expect(describeConfig(gatewayConfig({}))["ORDERS_URL"]).toBe("[set]");
  });
});
