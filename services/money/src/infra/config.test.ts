import { describe, expect, it } from "vitest";
import { describeConfig, moneyConfig } from "./config.js";

const minimal = {
  DATABASE_URL_MONEY: "postgres://runsheet@localhost:15432/money",
  SERVICE_CREDENTIAL: "rsk_service",
};

describe("money configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(moneyConfig(minimal).PORT_MONEY).toBe(14270);
  });

  it("refuses to start without a database", () => {
    expect(() => moneyConfig({})).toThrow(/DATABASE_URL_MONEY is required/);
  });

  it("refuses to start without its own credential for reading consignments", () => {
    expect(() => moneyConfig({ DATABASE_URL_MONEY: "postgres://x" })).toThrow(
      /SERVICE_CREDENTIAL is required/,
    );
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => moneyConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => moneyConfig({ ...minimal, PORT_MONEY: "http" })).toThrow(/PORT_MONEY/);
  });

  it("holds tolerances a finance team would want to change", () => {
    const config = moneyConfig(minimal);

    expect(config.SETTLEMENT_TOLERANCE_MINOR).toBe(100);
    expect(config.SETTLEMENT_AUTO_APPROVE_BELOW_MINOR).toBe(50000);
  });

  it("rejects a tolerance that is not a number", () => {
    expect(() => moneyConfig({ ...minimal, SETTLEMENT_TOLERANCE_MINOR: "loose" })).toThrow(
      /SETTLEMENT_TOLERANCE_MINOR/,
    );
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(moneyConfig(minimal));

    expect(described["DATABASE_URL_MONEY"]).toBe("[set]");
    expect(described["PORT_MONEY"]).toBe(14270);
  });
});
