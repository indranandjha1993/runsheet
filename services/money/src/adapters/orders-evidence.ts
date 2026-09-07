import { z } from "zod";
import type { EvidenceSource } from "../application/ports.js";
import type { Evidence } from "../domain/settlement.js";

// What the orders service says about a consignment, read strictly. Anything that does not fit is
// treated as no evidence, because a settlement must never rest on a field that was guessed.
const consignmentView = z.object({
  status: z.string(),
  service: z.string(),
  originHubCode: z.string(),
  destinationHubCode: z.string(),
  deliveredAt: z.iso.datetime().optional(),
  packages: z.array(z.object({ weightGrams: z.number().int().nonnegative() })),
});

export interface OrdersEvidenceOptions {
  readonly ordersUrl: string;
  readonly credential: string;
  readonly fetch?: typeof globalThis.fetch;
}

// The money service never reads the orders database. It asks, with its own credential and on the
// tenant's behalf, and takes what it is told. A consignment it cannot see is evidence it does not
// have, not a reason to pay. The price is left at zero here: the rate card supplies it.
export function ordersEvidence(options: OrdersEvidenceOptions): EvidenceSource {
  const call = options.fetch ?? globalThis.fetch;

  return {
    async forConsignment(tenantId, consignmentId) {
      const response = await call(`${options.ordersUrl}/v1/consignments/${consignmentId}`, {
        headers: {
          authorization: `Bearer ${options.credential}`,
          "x-on-behalf-of-tenant": tenantId,
        },
      });
      if (!response.ok) return undefined;

      const parsed = consignmentView.safeParse(await response.json());
      if (!parsed.success) return undefined;
      const consignment = parsed.data;

      const delivered = consignment.status === "delivered" && consignment.deliveredAt !== undefined;
      const evidence: Evidence = {
        expectedMinor: 0,
        currency: "",
        shippedWeightGrams: consignment.packages.reduce((total, p) => total + p.weightGrams, 0),
        proofSatisfiesRequirement: delivered,
        origin: consignment.originHubCode,
        destination: consignment.destinationHubCode,
        service: consignment.service,
        ...(delivered ? { deliveredAt: new Date(consignment.deliveredAt ?? "") } : {}),
      };
      return evidence;
    },
  };
}
