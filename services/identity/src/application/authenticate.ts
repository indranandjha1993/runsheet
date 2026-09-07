import { hashSecret, scopesAllow, verify, type Scope } from "../domain/api-key.js";
import { DomainError } from "../domain/errors.js";
import type { IdentityRepository } from "./ports.js";

export interface Caller {
  readonly tenantId: string;
  readonly keyId: string;
  readonly fingerprint: string;
  readonly scopes: readonly Scope[];
}

// Every failure returns the same message. Telling a caller whether a key exists, is revoked, or
// belongs to a disabled tenant hands them a way to enumerate keys.
const REFUSED = "the credential presented is not usable";

export async function authenticate(
  repository: IdentityRepository,
  presented: string | undefined,
): Promise<Caller> {
  if (presented === undefined || presented === "") {
    throw new DomainError("unauthorised", REFUSED);
  }

  const key = await repository.keyBySecretHash(hashSecret(presented));
  if (key === undefined || !verify(key, presented)) {
    throw new DomainError("unauthorised", REFUSED);
  }

  const tenant = await repository.tenantById(key.tenantId);
  if (tenant?.active !== true) {
    throw new DomainError("unauthorised", REFUSED);
  }

  return {
    tenantId: key.tenantId,
    keyId: key.id,
    fingerprint: key.fingerprint,
    scopes: key.scopes,
  };
}

export function authorise(caller: Caller, needed: Scope): void {
  if (!scopesAllow(caller.scopes, needed)) {
    throw new DomainError("forbidden", `this credential lacks the ${needed} scope`);
  }
}
