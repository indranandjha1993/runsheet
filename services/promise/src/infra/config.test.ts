import { describe, expect, it } from "vitest";
import { describeConfig, promiseConfig } from "./config.js";

const minimal = {
  DATABASE_URL_PROMISE: "postgres://runsheet@localhost:15432/promise",
  SIGNING_SECRET: "a-signing-secret-of-sufficient-length",
};

describe("promise configuration", () => {
  it("runs on the documented port when none is given", () => {
    expect(promiseConfig(minimal).PORT_PROMISE).toBe(14250);
  });

  it("refuses to start without a database", () => {
    expect(() => promiseConfig({})).toThrow(/DATABASE_URL_PROMISE is required/);
  });

  it("refuses to start with a signing secret too short to be safe", () => {
    expect(() => promiseConfig({ ...minimal, SIGNING_SECRET: "short" })).toThrow(/SIGNING_SECRET/);
  });

  it("gives tracking links a week by default", () => {
    expect(promiseConfig(minimal).TRACKING_LINK_TTL_HOURS).toBe(168);
  });

  it("points the reader at the example file when something is missing", () => {
    expect(() => promiseConfig({})).toThrow(/\.env\.example/);
  });

  it("rejects a port that is not a port", () => {
    expect(() => promiseConfig({ ...minimal, PORT_PROMISE: "http" })).toThrow(/PORT_PROMISE/);
  });

  it("hides the database address when describing itself for the log", () => {
    const described = describeConfig(promiseConfig(minimal));

    expect(described["DATABASE_URL_PROMISE"]).toBe("[set]");
    expect(described["PORT_PROMISE"]).toBe(14250);
  });
});
