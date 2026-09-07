export interface Upstream {
  readonly name: string;
  readonly prefixes: readonly string[];
  /** The tracking link is the only path anyone may reach without a credential. */
  readonly public?: boolean;
}

export const UPSTREAMS: readonly Upstream[] = [
  { name: "identity", prefixes: ["/v1/tenants", "/v1/keys", "/v1/callers"] },
  { name: "network", prefixes: ["/v1/hubs", "/v1/zones", "/v1/lanes", "/v1/serviceability"] },
  { name: "address", prefixes: ["/v1/addresses"] },
  { name: "orders", prefixes: ["/v1/orders", "/v1/consignments"] },
  { name: "execution", prefixes: ["/v1/runs", "/v1/proofs", "/v1/hub-scans"] },
  { name: "planning", prefixes: ["/v1/plans"] },
  { name: "promise", prefixes: ["/v1/promises"] },
  { name: "promise", prefixes: ["/track"], public: true },
  { name: "exceptions", prefixes: ["/v1/exceptions", "/v1/observations"] },
  { name: "policy", prefixes: ["/v1/policies", "/v1/decisions"] },
  { name: "linehaul", prefixes: ["/v1/bags", "/v1/trips"] },
  {
    name: "money",
    prefixes: [
      "/v1/carrier-accounts",
      "/v1/rate-cards",
      "/v1/invoices",
      "/v1/settlements",
      "/v1/cash",
    ],
  },
];

// A prefix matches only at a path boundary, so /v1/runsheets never reaches the runs service.
function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function upstreamFor(path: string): Upstream | undefined {
  return UPSTREAMS.find((upstream) => upstream.prefixes.some((prefix) => matches(path, prefix)));
}
