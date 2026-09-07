import { sign } from "./signature.js";

// Eight attempts spread over roughly a day. A receiver that is down overnight catches up in the
// morning without anybody replaying anything by hand.
const BACKOFF_SECONDS = [0, 30, 120, 600, 1800, 7200, 21600, 86400];

export interface Endpoint {
  readonly url: string;
  readonly secrets: readonly string[];
}

export interface DeliverableEvent {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface DeliverRequest {
  readonly endpoint: Endpoint;
  readonly event: DeliverableEvent;
  readonly at: Date;
  readonly attempt?: number;
  readonly fetch?: typeof globalThis.fetch;
}

export interface DeliveryResult {
  readonly delivered: boolean;
  readonly attempt: number;
  readonly retryable: boolean;
  readonly status?: number;
  readonly error?: string;
}

export function attemptsFor(): number {
  return BACKOFF_SECONDS.length;
}

export function nextAttemptAt(attempt: number, at: Date): Date | undefined {
  const seconds = BACKOFF_SECONDS[attempt - 1];
  return seconds === undefined ? undefined : new Date(at.getTime() + seconds * 1000);
}

// A receiver saying the request is malformed will say it again, so we stop. Anything else is
// treated as temporary, because most of the time it is.
function worthRetrying(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function deliver(request: DeliverRequest): Promise<DeliveryResult> {
  const attempt = request.attempt ?? 1;
  const call = request.fetch ?? globalThis.fetch;
  const body = JSON.stringify({
    id: request.event.id,
    type: request.event.type,
    payload: request.event.payload,
  });

  // Signed before the attempt, so a badly configured secret surfaces as the configuration error
  // it is rather than looking like a receiver that was unreachable.
  const signature = sign(body, request.endpoint.secrets, request.at);

  try {
    const response = await call(request.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "runsheet-event-id": request.event.id,
        "runsheet-event-type": request.event.type,
        "runsheet-signature": signature,
      },
      body,
    });

    return {
      delivered: response.ok,
      attempt,
      retryable: !response.ok && worthRetrying(response.status),
      status: response.status,
    };
  } catch (error) {
    return {
      delivered: false,
      attempt,
      retryable: true,
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}
