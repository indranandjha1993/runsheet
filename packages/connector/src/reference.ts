import type {
  Booking,
  BookCall,
  CallContext,
  Cancellation,
  CancelCall,
  Connector,
  Quote,
  QuoteCall,
  QuoteRequest,
  Result,
  TrackCall,
  Tracking,
} from "./contract.js";

// A working connector, small enough to read in one sitting. It is what an author copies: the
// shape of every operation, how failures are reported, and what idempotency has to mean.

const SERVICES: Record<string, { readonly baseMinor: number; readonly transitDays: number }> = {
  standard: { baseMinor: 6000, transitDays: 3 },
  express: { baseMinor: 14000, transitDays: 1 },
};

const PER_KILO_MINOR = 2000;

interface Shipment {
  readonly reference: string;
  readonly service: string;
  cancelled: boolean;
}

function credentialed<T>(context: CallContext): Result<T> | undefined {
  return context.credentials["api_key"] === undefined
    ? { outcome: "failed", kind: "misconfigured", message: "no api_key was configured" }
    : undefined;
}

function kilos(request: QuoteRequest): number {
  const grams = request.parcels.reduce((total, parcel) => total + parcel.weightGrams, 0);
  return Math.max(1, Math.ceil(grams / 1000));
}

interface Ledger {
  readonly booked: Map<string, Shipment>;
  readonly byIdempotencyKey: Map<string, Booking>;
  issued: number;
}

function missing<T>(carrierReference: string): Result<T> {
  return {
    outcome: "failed",
    kind: "not_found",
    message: `nothing booked under ${carrierReference}`,
  };
}

function quoting(): QuoteCall {
  return (context, request) => {
    const refusal = credentialed<Quote[]>(context);
    if (refusal !== undefined) return Promise.resolve(refusal);

    const weight = kilos(request);
    return Promise.resolve({
      outcome: "ok",
      value: Object.entries(SERVICES).map(([service, rate]) => ({
        service,
        amountMinor: rate.baseMinor + weight * PER_KILO_MINOR,
        currency: "INR",
        transitDays: rate.transitDays,
      })),
    });
  };
}

// The same key means the same booking. A carrier that issued a second reference for a retried
// call would leave the platform paying for two shipments of one parcel.
function booking(ledger: Ledger): BookCall {
  return (context, request) => {
    const refusal = credentialed<Booking>(context);
    if (refusal !== undefined) return Promise.resolve(refusal);

    const already = ledger.byIdempotencyKey.get(context.idempotencyKey);
    if (already !== undefined) return Promise.resolve({ outcome: "ok", value: already });

    if (SERVICES[request.service] === undefined) {
      return Promise.resolve({
        outcome: "failed",
        kind: "rejected",
        message: `no service called ${request.service}`,
        code: "unknown_service",
      });
    }

    ledger.issued += 1;
    const carrierReference = `REF${String(ledger.issued).padStart(8, "0")}`;
    ledger.booked.set(carrierReference, {
      reference: request.reference,
      service: request.service,
      cancelled: false,
    });

    const made: Booking = {
      carrierReference,
      labels: [{ format: "zpl", data: `^XA^FD${carrierReference}^FS^XZ` }],
    };
    ledger.byIdempotencyKey.set(context.idempotencyKey, made);
    return Promise.resolve({ outcome: "ok", value: made });
  };
}

function tracking(ledger: Ledger): TrackCall {
  return (context, request) => {
    const refusal = credentialed<Tracking>(context);
    if (refusal !== undefined) return Promise.resolve(refusal);

    const shipment = ledger.booked.get(request.carrierReference);
    if (shipment === undefined) return Promise.resolve(missing(request.carrierReference));

    return Promise.resolve({
      outcome: "ok",
      value: {
        status: shipment.cancelled ? "cancelled" : "in_transit",
        events: [{ at: new Date(0), status: "accepted", description: "collected from origin" }],
      },
    });
  };
}

function cancelling(ledger: Ledger): CancelCall {
  return (context, request) => {
    const refusal = credentialed<Cancellation>(context);
    if (refusal !== undefined) return Promise.resolve(refusal);

    const shipment = ledger.booked.get(request.carrierReference);
    if (shipment === undefined) return Promise.resolve(missing(request.carrierReference));
    if (shipment.cancelled) {
      return Promise.resolve({
        outcome: "failed",
        kind: "rejected",
        message: "that shipment is already cancelled",
        code: "already_cancelled",
      });
    }

    shipment.cancelled = true;
    return Promise.resolve({ outcome: "ok", value: { cancelled: true } });
  };
}

export function referenceCarrier(): Connector {
  const ledger: Ledger = { booked: new Map(), byIdempotencyKey: new Map(), issued: 0 };

  return {
    name: "reference-carrier",
    version: "1.0.0",
    capabilities: ["quote", "book", "track", "cancel"],
    quote: quoting(),
    book: booking(ledger),
    track: tracking(ledger),
    cancel: cancelling(ledger),
  };
}
