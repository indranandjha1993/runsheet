// What a third party writes to plug a carrier into the platform. Everything here is data in and
// data out: a connector never touches a database, never publishes an event, and never decides
// anything. The platform does that, so a badly behaved connector cannot corrupt anything.

const SEMVER = /^\d+\.\d+\.\d+$/;

export type Capability = "quote" | "book" | "track" | "cancel";

export type Failure =
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "rejected"; readonly message: string; readonly code?: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "throttled"; readonly retryAfterSeconds: number }
  | { readonly kind: "misconfigured"; readonly message: string };

export type Result<T> =
  | { readonly outcome: "ok"; readonly value: T }
  | ({
      readonly outcome: "failed";
    } & Failure);

export type Credentials = Readonly<Record<string, string>>;

export interface CallContext {
  readonly tenantId: string;
  readonly credentials: Credentials;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
}

export interface Parcel {
  readonly weightGrams: number;
  readonly lengthMm?: number;
  readonly widthMm?: number;
  readonly heightMm?: number;
}

export interface Place {
  readonly line: string;
  readonly city: string;
  readonly postcode: string;
  readonly countryCode: string;
}

export interface QuoteRequest {
  readonly origin: Place;
  readonly destination: Place;
  readonly parcels: readonly Parcel[];
  readonly service?: string;
}

export interface Quote {
  readonly service: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly transitDays: number;
}

export interface BookRequest extends QuoteRequest {
  readonly reference: string;
  readonly service: string;
  readonly codAmountMinor?: number;
  readonly codCurrency?: string;
}

export interface Booking {
  readonly carrierReference: string;
  readonly labels: readonly { readonly format: string; readonly data: string }[];
}

export interface TrackRequest {
  readonly carrierReference: string;
}

export interface Tracking {
  readonly status: string;
  readonly events: readonly {
    readonly at: Date;
    readonly status: string;
    readonly description?: string;
  }[];
}

export interface CancelRequest {
  readonly carrierReference: string;
}

export interface Cancellation {
  readonly cancelled: boolean;
}

export type QuoteCall = (context: CallContext, request: QuoteRequest) => Promise<Result<Quote[]>>;
export type BookCall = (context: CallContext, request: BookRequest) => Promise<Result<Booking>>;
export type TrackCall = (context: CallContext, request: TrackRequest) => Promise<Result<Tracking>>;
export type CancelCall = (
  context: CallContext,
  request: CancelRequest,
) => Promise<Result<Cancellation>>;

export interface Connector {
  readonly name: string;
  readonly version: string;
  readonly capabilities: readonly Capability[];
  readonly quote?: QuoteCall | undefined;
  readonly book?: BookCall | undefined;
  readonly track?: TrackCall | undefined;
  readonly cancel?: CancelCall | undefined;
}

export function supports(connector: Connector, capability: Capability): boolean {
  return connector.capabilities.includes(capability);
}

// Checked when a connector is registered, not when a parcel is being booked. A connector that
// claims something it cannot do would otherwise fail in front of a customer.
export function assertConnector(connector: Connector): void {
  if (connector.name.trim() === "") throw new Error("a connector needs a name");
  if (!SEMVER.test(connector.version)) throw new Error("version must look like 1.2.3");
  if (connector.capabilities.length === 0) {
    throw new Error("a connector must do at least one thing");
  }

  for (const capability of connector.capabilities) {
    if (typeof connector[capability] !== "function") {
      throw new Error(`${connector.name} claims ${capability} but does not implement it`);
    }
  }
}

export function describeConnector(connector: Connector): string {
  return `${connector.name} ${connector.version} (${connector.capabilities.join(", ")})`;
}
