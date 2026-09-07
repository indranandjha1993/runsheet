import { assertConnector, supports, type Capability, type Connector } from "./contract.js";

export interface Registry {
  find(name: string): Connector | undefined;
  all(): Connector[];
  capableOf(capability: Capability): Connector[];
}

// Every connector is checked once, here, before anything is routed to it. A connector that fails
// the contract stops the platform from starting rather than failing during a booking.
export function newRegistry(connectors: readonly Connector[]): Registry {
  const byName = new Map<string, Connector>();

  for (const connector of connectors) {
    assertConnector(connector);
    if (byName.has(connector.name)) {
      throw new Error(`${connector.name} is registered twice`);
    }
    byName.set(connector.name, connector);
  }

  const sorted = (): Connector[] =>
    [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    find: (name) => byName.get(name),
    all: sorted,
    capableOf: (capability) => sorted().filter((one) => supports(one, capability)),
  };
}
