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
        "linehaul",
        "reporting",
      ]),
    );
  });
});

describe("the newest services", () => {
  it("sends bag and trip paths to the linehaul service", () => {
    expect(upstreamFor("/v1/bags/parcels")?.name).toBe("linehaul");
    expect(upstreamFor("/v1/trips/t1/manifest")?.name).toBe("linehaul");
  });

  it("sends hub scans to execution, not to orders", () => {
    expect(upstreamFor("/v1/hub-scans")?.name).toBe("execution");
  });

  it("sends the cash ledger to the money service", () => {
    expect(upstreamFor("/v1/cash/movements")?.name).toBe("money");
  });

  it("still sends label printing to orders, because the consignment owns it", () => {
    expect(upstreamFor("/v1/consignments/c1/labels")?.name).toBe("orders");
  });

  it("gives every prefix exactly one upstream", () => {
    const seen = new Map<string, string>();
    for (const upstream of UPSTREAMS) {
      for (const prefix of upstream.prefixes) {
        const already = seen.get(prefix);
        expect(already ?? upstream.name).toBe(upstream.name);
        seen.set(prefix, upstream.name);
      }
    }
  });
});
