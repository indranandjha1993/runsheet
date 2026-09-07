import { describe, expect, it } from "vitest";
import { upstreamFor, UPSTREAMS } from "./routing-table.js";

describe("finding the service behind a path", () => {
  it("sends consignments to orders", () => {
    expect(upstreamFor("/v1/consignments")?.name).toBe("orders");
    expect(upstreamFor("/v1/consignments/abc/events")?.name).toBe("orders");
  });

  it("sends runs and proofs to execution", () => {
    expect(upstreamFor("/v1/runs")?.name).toBe("execution");
    expect(upstreamFor("/v1/proofs")?.name).toBe("execution");
  });

  it("sends hubs and serviceability to network", () => {
    expect(upstreamFor("/v1/hubs")?.name).toBe("network");
    expect(upstreamFor("/v1/serviceability")?.name).toBe("network");
  });

  it("sends the public tracking link to promise", () => {
    expect(upstreamFor("/track/abc.def")?.name).toBe("promise");
  });

  it("sends tenants and keys to identity", () => {
    expect(upstreamFor("/v1/tenants")?.name).toBe("identity");
    expect(upstreamFor("/v1/keys/abc/revoke")?.name).toBe("identity");
  });

  it("sends invoices and settlements to money", () => {
    expect(upstreamFor("/v1/invoices")?.name).toBe("money");
    expect(upstreamFor("/v1/settlements/abc/events")?.name).toBe("money");
  });

  it("sends policies and decisions to policy", () => {
    expect(upstreamFor("/v1/policies")?.name).toBe("policy");
    expect(upstreamFor("/v1/decisions/abc/replayable")?.name).toBe("policy");
  });

  it("knows nothing about a path nobody registered", () => {
    expect(upstreamFor("/v1/nothing")).toBeUndefined();
    expect(upstreamFor("/")).toBeUndefined();
  });

  it("does not confuse a path that merely starts with a known prefix", () => {
    expect(upstreamFor("/v1/runsheets")).toBeUndefined();
  });

  it("covers every service the platform runs", () => {
    const named = new Set(UPSTREAMS.map((upstream) => upstream.name));

    expect(named).toEqual(
      new Set([
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
      ]),
    );
  });
});
