import {
  supports,
  type CallContext,
  type Capability,
  type Connector,
  type Failure,
  type Result,
} from "./contract.js";

// A carrier's system is somebody else's, on somebody else's network, written to somebody else's
// standards. The runner assumes it will hang, lie, and throw, so no connector author has to
// think about any of that and no misbehaving one can hold up a booking.

export const TIMEOUT_MS = 20_000;
const BACKOFF_MS = [0, 500, 2000, 8000];

export interface RunOptions {
  readonly attempts?: number;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

type Operation = Extract<Capability, "quote" | "book" | "track" | "cancel">;

function failed(failure: Failure): Result<never> {
  return { outcome: "failed", ...failure };
}

function isResult(value: unknown): value is Result<unknown> {
  if (typeof value !== "object" || value === null || !("outcome" in value)) return false;
  const { outcome } = value;
  return outcome === "ok" || outcome === "failed";
}

// A rejection or a bad credential will be the same next time. Only a carrier that was unreachable
// or asked us to slow down is worth trying again.
function worthRetrying(result: Result<unknown>): boolean {
  return (
    result.outcome === "failed" && (result.kind === "unavailable" || result.kind === "throttled")
  );
}

function waitFor(result: Result<unknown>, attempt: number): number {
  if (result.outcome === "failed" && result.kind === "throttled") {
    return result.retryAfterSeconds * 1000;
  }
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 0;
}

interface Attempt {
  readonly connector: Connector;
  readonly operation: Operation;
  readonly context: Omit<CallContext, "signal">;
  readonly request: unknown;
  readonly timeoutMs: number;
}

async function callOnce(attempt: Attempt): Promise<Result<unknown>> {
  const { connector, operation, context, request, timeoutMs } = attempt;
  const controller = new AbortController();
  const cutOff = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const call = connector[operation] as
      ((context: CallContext, request: unknown) => Promise<unknown>) | undefined;
    if (call === undefined) {
      return failed({ kind: "misconfigured", message: `${connector.name} cannot ${operation}` });
    }

    const answer = await call({ ...context, signal: controller.signal }, request);
    // A connector that returns something other than a result is broken, not unlucky, but the
    // platform still has to keep going.
    return isResult(answer)
      ? answer
      : failed({ kind: "unavailable", message: `${connector.name} answered with nonsense` });
  } catch {
    // Whatever it threw is the connector author's business, not the caller's, and it may carry
    // credentials in it. The caller learns only that the carrier could not be reached.
    return failed({ kind: "unavailable", message: `${connector.name} could not be reached` });
  } finally {
    clearTimeout(cutOff);
  }
}

export interface Call {
  readonly context: Omit<CallContext, "signal">;
  readonly request: unknown;
  readonly options?: RunOptions;
}

export async function runCall<T>(
  connector: Connector,
  operation: Operation,
  call: Call,
): Promise<Result<T>> {
  const { context, request } = call;
  const options = call.options ?? {};
  if (!supports(connector, operation)) {
    return failed({ kind: "misconfigured", message: `${connector.name} does not do ${operation}` });
  }

  const attempts = options.attempts ?? BACKOFF_MS.length;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));

  let last: Result<unknown> = failed({ kind: "unavailable", message: "never called" });

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // The same key every time. A carrier that took the first attempt and lost the reply must
    // recognise the retry rather than book the parcel twice.
    last = await callOnce({ connector, operation, context, request, timeoutMs });
    if (!worthRetrying(last)) return last as Result<T>;
    if (attempt < attempts) await sleep(waitFor(last, attempt));
  }

  return last as Result<T>;
}
