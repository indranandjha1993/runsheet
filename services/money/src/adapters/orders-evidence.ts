import type { EvidenceSource } from "../application/ports.js";
import type { Evidence } from "../domain/settlement.js";

interface ConsignmentView {
  readonly paymentMode: string;
  readonly packages: readonly { readonly weightGrams: number }[];
  readonly status: string;
}

export interface OrdersEvidenceOptions {
  readonly ordersUrl: string;
  readonly credential: string;
  readonly fetch?: typeof globalThis.fetch;
}

// The money service never reads the orders database. It asks, with its own credential, and takes
// what it is told. A consignment it cannot see is evidence it does not have, not a reason to pay.
export function ordersEvidence(options: OrdersEvidenceOptions): EvidenceSource {
  const call = options.fetch ?? globalThis.fetch;

  return {
    async forConsignment(_tenantId, consignmentId) {
      const response = await call(`${options.ordersUrl}/v1/consignments/${consignmentId}`, {
        headers: { authorization: `Bearer ${options.credential}` },
      });
      if (!response.ok) return undefined;

      const consignment = (await response.json()) as ConsignmentView;
      const shippedWeightGrams = consignment.packages.reduce(
        (total, parcel) => total + parcel.weightGrams,
        0,
      );

      const evidence: Evidence = {
        expectedMinor: 0,
        currency: "",
        shippedWeightGrams,
        proofSatisfiesRequirement: consignment.status === "delivered",
        ...(consignment.status === "delivered" ? { deliveredAt: new Date() } : {}),
      };
      return evidence;
    },
  };
}
