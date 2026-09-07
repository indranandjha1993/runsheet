import { describe, expect, it } from "vitest";
import { describeConfig, identityConfig } from "./config.js";

const minimal = { DATABASE_URL_IDENTITY: "postgres://runsheet@localhost:15432/identity_tenancy" };

describe("identity configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(identityConfig(minimal).PORT_IDENTITY).toBe(14200);
  });

  it("refuses to start without a database", () => {
    expect(() => identityConfig({})).toThrow(/DATABASE_URL_IDENTITY is required/);
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => identityConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => identityConfig({ ...minimal, PORT_IDENTITY: "http" })).toThrow(/PORT_IDENTITY/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(identityConfig(minimal));

    expect(described["DATABASE_URL_IDENTITY"]).toBe("[set]");
    expect(described["PORT_IDENTITY"]).toBe(14200);
  });
});
