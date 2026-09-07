import { describe, expect, it } from "vitest";
import { upstreamFor, UPSTREAMS } from "./routing-table.js";

// Every path in spec/openapi.json. A route the gateway cannot reach is a route nobody can
// call, however well it is documented.
const PUBLISHED_PATHS = [
  "/track/:token",
  "/v1/addresses",
  "/v1/addresses/:id",
  "/v1/addresses/:id/confirm",
  "/v1/bags/:id",
  "/v1/bags/:id/events",
  "/v1/bags/:id/seal",
  "/v1/bags/parcels",
  "/v1/baselines/comparison",
  "/v1/baselines/metrics",
  "/v1/callers/current",
  "/v1/carrier-accounts",
  "/v1/cash/drivers/:id/statement",
  "/v1/cash/merchants/:id/statement",
  "/v1/cash/movements",
  "/v1/cash/runs/:id/close",
  "/v1/consignments",
  "/v1/consignments/:id",
  "/v1/consignments/:id/events",
  "/v1/consignments/:id/labels",
  "/v1/decisions",
  "/v1/decisions/:id/events",
  "/v1/decisions/:id/replayable",
  "/v1/exceptions",
  "/v1/exceptions/:id",
  "/v1/exceptions/:id/events",
  "/v1/hub-scans",
  "/v1/hub-scans/in",
  "/v1/hub-scans/out",
  "/v1/hubs",
  "/v1/invoices",
  "/v1/invoices/:id/settlements",
  "/v1/keys",
  "/v1/keys/:id/revoke",
  "/v1/observations",
  "/v1/plans",
  "/v1/plans/:hubId/:date",
  "/v1/policies",
  "/v1/policies/:id/calibration",
  "/v1/policies/:id/events",
  "/v1/promises",
  "/v1/promises/:id/eta",
  "/v1/promises/:id/settle",
  "/v1/proofs",
  "/v1/rate-cards",
  "/v1/reports",
  "/v1/reports/:name",
  "/v1/runs",
  "/v1/runs/:id",
  "/v1/runs/:id/actions",
  "/v1/runs/:id/events",
  "/v1/serviceability",
  "/v1/settlements/:id/events",
  "/v1/sync/batches",
  "/v1/tenants",
  "/v1/tenants/:id",
  "/v1/tenants/:id/keys",
  "/v1/trips",
  "/v1/trips/:id/bags",
  "/v1/trips/:id/events",
  "/v1/trips/:id/manifest",
];

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

  it("sends a handset's shift to execution", () => {
    expect(upstreamFor("/v1/sync/batches")?.name).toBe("execution");
  });

  it("has an upstream for every path the published specification declares", () => {
    for (const path of PUBLISHED_PATHS) {
      expect(upstreamFor(path)).toBeDefined();
    }
  });

  it("sends baseline measurement to the reporting service", () => {
    expect(upstreamFor("/v1/baselines/comparison")?.name).toBe("reporting");
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
