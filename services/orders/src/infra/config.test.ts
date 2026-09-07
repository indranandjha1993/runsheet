import { describe, expect, it } from "vitest";
import { describeConfig, ordersConfig } from "./config.js";

const minimal = { DATABASE_URL_ORDERS: "postgres://runsheet@localhost:15432/orders_consignments" };

describe("orders configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(ordersConfig(minimal).PORT_ORDERS).toBe(14220);
  });

  it("refuses to start without a database", () => {
    expect(() => ordersConfig({})).toThrow(/DATABASE_URL_ORDERS is required/);
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => ordersConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => ordersConfig({ ...minimal, PORT_ORDERS: "http" })).toThrow(/PORT_ORDERS/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(ordersConfig(minimal));

    expect(described["DATABASE_URL_ORDERS"]).toBe("[set]");
    expect(described["PORT_ORDERS"]).toBe(14220);
  });
});
