import { issue, type ApiKey } from "../domain/api-key.js";
import { createTenant, type Tenant } from "../domain/tenant.js";
import { DomainError } from "../domain/errors.js";
import type { IdentityDeps } from "./ports.js";

export interface RegisterTenantCommand {
  readonly name: string;
  readonly countryCode: string;
  readonly currency: string;
  readonly locale: string;
  readonly region: string;
}

export async function registerTenant(
  deps: IdentityDeps,
  command: RegisterTenantCommand,
): Promise<Tenant> {
  const tenant = createTenant({ id: deps.ids.next(), ...command });
  await deps.repository.saveTenant(tenant);
  return tenant;
}

export interface IssueKeyCommand {
  readonly tenantId: string;
  readonly name: string;
  readonly scopes: readonly string[];
}

export async function issueKey(
  deps: IdentityDeps,
  command: IssueKeyCommand,
): Promise<{ id: string; secret: string; scopes: readonly string[] }> {
  const tenant = await deps.repository.tenantById(command.tenantId);
  if (tenant === undefined) throw new DomainError("not_found", "no tenant with that identifier");

  const issued = issue({
    id: deps.ids.next(),
    tenantId: command.tenantId,
    name: command.name,
    scopes: command.scopes,
    secret: deps.secrets.next(),
  });

  await deps.repository.saveKey(issued.record);

  // The secret is returned here and never again. Nothing stores it.
  return { id: issued.record.id, secret: issued.presentedSecret, scopes: issued.record.scopes };
}

export async function revokeKey(
  deps: IdentityDeps,
  tenantId: string,
  keyId: string,
): Promise<void> {
  const revoked = await deps.repository.revokeKey(tenantId, keyId, deps.clock.now());
  if (!revoked) throw new DomainError("not_found", "no usable key with that identifier");
}

export async function listKeys(deps: IdentityDeps, tenantId: string): Promise<ApiKey[]> {
  return deps.repository.keysFor(tenantId);
}
