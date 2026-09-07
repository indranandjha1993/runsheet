import type { Caller, CallerLookup } from "./caller.js";

// Services do not read the identity database. They ask the identity service, and cache the
// answer briefly so a hot path does not make a network call per request. A revoked key stops
// working within the cache window, which is the trade being made here deliberately.
export interface RemoteLookupOptions {
  readonly identityUrl: string;
  readonly cacheMs?: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
}

interface Cached {
  readonly caller: Caller | undefined;
  readonly until: number;
}

export function remoteLookup(options: RemoteLookupOptions): CallerLookup {
  const cache = new Map<string, Cached>();
  const cacheMs = options.cacheMs ?? 30_000;
  const call = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;

  return async (presented) => {
    const hit = cache.get(presented);
    if (hit !== undefined && hit.until > now()) return hit.caller;

    const response = await call(`${options.identityUrl}/v1/callers/current`, {
      headers: { authorization: `Bearer ${presented}` },
    });
    const caller = response.ok ? ((await response.json()) as Caller) : undefined;

    cache.set(presented, { caller, until: now() + cacheMs });
    return caller;
  };
}
