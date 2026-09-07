export interface Caller {
  readonly tenantId: string;
  readonly keyId: string;
  readonly fingerprint: string;
  readonly scopes: readonly string[];
}

export type CallerLookup = (presented: string) => Promise<Caller | undefined>;

export class NotAuthenticated extends Error {
  readonly status = 401;
  readonly code = "unauthorised";

  constructor() {
    super("the credential presented is not usable");
    this.name = "NotAuthenticated";
  }
}

export class NotPermitted extends Error {
  readonly status = 403;
  readonly code = "forbidden";

  constructor(scope: string) {
    super(`this credential lacks the ${scope} scope`);
    this.name = "NotPermitted";
  }
}

function bearerFrom(headers: Record<string, string | undefined>): string | undefined {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "authorization" || value === undefined) continue;
    const [scheme, credential] = value.split(" ");
    if (scheme?.toLowerCase() === "bearer" && credential !== undefined) return credential;
  }
  return undefined;
}

// The tenant comes from the credential and nowhere else. A header naming a tenant is ignored,
// because a caller must never be able to choose whose data they see.
export async function callerFrom(
  lookup: CallerLookup,
  headers: Record<string, string | undefined>,
): Promise<Caller> {
  const presented = bearerFrom(headers);
  if (presented === undefined) throw new NotAuthenticated();

  const caller = await lookup(presented);
  if (caller === undefined) throw new NotAuthenticated();
  return caller;
}

export function requireScope(caller: Caller, needed: string): void {
  if (caller.scopes.includes(needed)) return;
  if (needed === "pii:read") throw new NotPermitted(needed);

  const separator = needed.indexOf(":");
  const isRead = needed.slice(separator + 1) === "read";
  const write = `${needed.slice(0, separator)}:write`;
  if (isRead && caller.scopes.includes(write)) return;

  throw new NotPermitted(needed);
}
