import { z } from "zod";
import { callerFrom, requireScope, type CallerLookup } from "@runsheet/auth";
import { DomainError } from "../domain/errors.js";
import { rateCard } from "../domain/rate-card.js";
import type { Route } from "../adapters/http.js";
import { receiveInvoice, workSettlement } from "../application/reconcile.js";
import type { MoneyDeps } from "../application/ports.js";
import { closeDriverRun, recordMovement, statementFor } from "../application/cash.js";
import type { SettlementEvent } from "../domain/settlement.js";

export const carrierBody = z.object({ name: z.string().min(1), currency: z.string().length(3) });

export const rateCardBody = z.object({
  carrier_account_id: z.string().min(1),
  currency: z.string().length(3),
  valid_from: z.iso.datetime(),
  valid_until: z.iso.datetime().optional(),
  lanes: z
    .array(
      z.object({
        origin: z.string().min(1),
        destination: z.string().min(1),
        service: z.string().min(1),
        bands: z
          .array(
            z.object({
              up_to_grams: z.number().int().positive(),
              price_minor: z.number().int().nonnegative(),
            }),
          )
          .min(1),
        surcharges: z.array(z.object({ code: z.string().min(1), percent: z.number() })).default([]),
      }),
    )
    .min(1),
});

export const invoiceBody = z.object({
  carrier_account_id: z.string().min(1),
  number: z.string().min(1),
  currency: z.string().length(3),
  lines: z
    .array(
      z.object({
        consignment_id: z.string().min(1),
        billed_minor: z.number().int(),
        billed_weight_grams: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export const settlementBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approved"), by: z.string().min(1) }),
  z.object({ type: z.literal("disputed"), by: z.string().min(1), note: z.string() }),
  z.object({
    type: z.literal("dispute_resolved"),
    agreed_minor: z.number().int(),
    by: z.string().min(1),
  }),
  z.object({ type: z.literal("dispute_rejected"), by: z.string().min(1) }),
  z.object({ type: z.literal("paid"), reference: z.string().min(1) }),
  z.object({ type: z.literal("written_off"), by: z.string().min(1), note: z.string() }),
]);

type SettlementBody = z.infer<typeof settlementBody>;

const SETTLEMENT_STATES = [
  "matched",
  "mismatched",
  "missing_evidence",
  "approved",
  "disputed",
  "paid",
  "written_off",
] as const;

function invoicesRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/invoices",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "money:read");

      const invoices = await deps.repository.invoicesFor(caller.tenantId);
      return { status: 200, body: { invoices } };
    },
  };
}

function settlementsRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/settlements",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "money:read");

      const parsed = z.enum(SETTLEMENT_STATES).safeParse(request.query["state"]);
      if (!parsed.success) return invalid("name a settlement state");
      const settlements = await deps.repository.settlementsInState(caller.tenantId, parsed.data);
      return { status: 200, body: { settlements } };
    },
  };
}

export interface RouteDeps extends MoneyDeps {
  readonly lookup: CallerLookup;
}

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function toEvent(body: SettlementBody): SettlementEvent {
  if (body.type === "approved") return { type: "approved", by: body.by, automatic: false };
  if (body.type === "dispute_resolved") {
    return { type: "dispute_resolved", agreedMinor: body.agreed_minor, by: body.by };
  }
  return body;
}

function carrierRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/carrier-accounts",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "money:write");

      const parsed = carrierBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const account = {
        id: deps.ids.next(),
        tenantId: caller.tenantId,
        name: parsed.data.name,
        currency: parsed.data.currency,
      };
      await deps.repository.saveCarrier(account);
      return { status: 201, body: account };
    },
  };
}

function rateCardRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/rate-cards",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "money:write");

      const parsed = rateCardBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const card = rateCard({
        id: deps.ids.next(),
        tenantId: caller.tenantId,
        carrierAccountId: parsed.data.carrier_account_id,
        currency: parsed.data.currency,
        validFrom: new Date(parsed.data.valid_from),
        ...(parsed.data.valid_until === undefined
          ? {}
          : { validUntil: new Date(parsed.data.valid_until) }),
        lanes: parsed.data.lanes.map((lane) => ({
          origin: lane.origin,
          destination: lane.destination,
          service: lane.service,
          bands: lane.bands.map((band) => ({
            upToGrams: band.up_to_grams,
            priceMinor: band.price_minor,
          })),
          surcharges: lane.surcharges,
        })),
      });

      await deps.repository.saveRateCard(card);
      return { status: 201, body: card };
    },
  };
}

function invoiceRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/invoices",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "money:write");

      const parsed = invoiceBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const result = await receiveInvoice(deps, {
        tenantId: caller.tenantId,
        carrierAccountId: parsed.data.carrier_account_id,
        number: parsed.data.number,
        currency: parsed.data.currency,
        lines: parsed.data.lines.map((line) => ({
          consignmentId: line.consignment_id,
          billedMinor: line.billed_minor,
          billedWeightGrams: line.billed_weight_grams,
        })),
      });

      return { status: result.alreadyReceived ? 200 : 201, body: result };
    },
  };
}

function settlementRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/settlements/:id/events",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "money:write");

      const parsed = settlementBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const settlement = await workSettlement(deps, {
        tenantId: caller.tenantId,
        settlementId: request.params["id"] ?? "",
        event: toEvent(parsed.data),
      });

      return { status: 200, body: settlement };
    },
  };
}

function readRoute(deps: RouteDeps): Route {
  return {
    method: "GET",
    path: "/v1/invoices/:id/settlements",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "money:read");

      const settlements = await deps.repository.settlementsFor(
        caller.tenantId,
        request.params["id"] ?? "",
      );
      if (settlements.length === 0) {
        throw new DomainError("not_found", "no settlements for that invoice");
      }
      return { status: 200, body: settlements };
    },
  };
}

export const movementBody = z.object({
  kind: z.enum(["collected", "deposited", "remitted", "written_off", "reversed"]),
  amount_minor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reference: z.string().min(1),
  driver_id: z.string().min(1).optional(),
  merchant_id: z.string().min(1).optional(),
  approved_by: z.string().min(1).optional(),
});

export const closeBody = z.object({
  driver_id: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  counted_minor: z.number().int().nonnegative(),
});

function movementRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/cash/movements",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "money:write");

      const parsed = movementBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const balances = await recordMovement(deps, {
        tenantId: caller.tenantId,
        kind: parsed.data.kind,
        amountMinor: parsed.data.amount_minor,
        currency: parsed.data.currency,
        reference: parsed.data.reference,
        ...(parsed.data.driver_id === undefined ? {} : { driverId: parsed.data.driver_id }),
        ...(parsed.data.merchant_id === undefined ? {} : { merchantId: parsed.data.merchant_id }),
        ...(parsed.data.approved_by === undefined ? {} : { approvedBy: parsed.data.approved_by }),
      });

      return {
        status: 201,
        body: {
          driver_float_minor: balances.driverFloatMinor,
          merchant_payable_minor: balances.merchantPayableMinor,
        },
      };
    },
  };
}

function runCloseRoute(deps: RouteDeps): Route {
  return {
    method: "POST",
    path: "/v1/cash/runs/:id/close",
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "money:write");

      const parsed = closeBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const close = await closeDriverRun(deps, {
        tenantId: caller.tenantId,
        runId: request.params["id"] ?? "",
        driverId: parsed.data.driver_id,
        currency: parsed.data.currency,
        countedMinor: parsed.data.counted_minor,
      });

      return {
        status: 200,
        body: {
          expected_minor: close.expectedMinor,
          counted_minor: close.countedMinor,
          variance_minor: close.varianceMinor,
          float_after_minor: close.floatAfterMinor,
        },
      };
    },
  };
}

function statementRoute(deps: RouteDeps, holder: "drivers" | "merchants"): Route {
  return {
    method: "GET",
    path: `/v1/cash/${holder}/:id/statement`,
    handle: async (request) => {
      const caller = await callerFrom(deps.lookup, request.headers);
      requireScope(caller, "money:read");

      const currency = request.query["currency"] ?? "";
      if (!/^[A-Z]{3}$/.test(currency)) return invalid("name the currency of the statement");

      const id = request.params["id"] ?? "";
      const statement = await statementFor(deps, {
        tenantId: caller.tenantId,
        currency,
        ...(holder === "drivers" ? { driverId: id } : { merchantId: id }),
      });

      return {
        status: 200,
        body: {
          currency,
          ...(holder === "drivers"
            ? { float_minor: statement.floatMinor }
            : { payable_minor: statement.payableMinor }),
          entries: statement.entries.map((entry) => ({
            kind: entry.kind,
            reference: entry.reference,
            delta_minor: entry.deltaMinor,
            occurred_at: entry.at,
          })),
        },
      };
    },
  };
}

export function moneyRoutes(deps: RouteDeps): Route[] {
  return [
    carrierRoute(deps),
    rateCardRoute(deps),
    invoiceRoute(deps),
    settlementRoute(deps),
    readRoute(deps),
    invoicesRoute(deps),
    settlementsRoute(deps),
    movementRoute(deps),
    runCloseRoute(deps),
    statementRoute(deps, "drivers"),
    statementRoute(deps, "merchants"),
  ];
}
