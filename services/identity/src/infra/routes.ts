import { z } from "zod";
import { DomainError } from "../domain/errors.js";
import type { Route } from "../adapters/http.js";
import { authenticate } from "../application/authenticate.js";
import { issueKey, listKeys, registerTenant, revokeKey } from "../application/manage-keys.js";
import type { IdentityDeps } from "../application/ports.js";

const tenantBody = z.object({
  name: z.string().min(1),
  country_code: z.string().length(2),
  currency: z.string().length(3),
  locale: z.string().min(1),
  region: z.string().min(1),
});

const keyBody = z.object({
  tenant_id: z.string().min(1),
  name: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
});

function invalid(message: string): { status: number; body: unknown } {
  return { status: 400, body: { error: { code: "invalid_request", message } } };
}

function bearerOf(headers: Record<string, string | undefined>): string | undefined {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "authorization" || value === undefined) continue;
    const [scheme, credential] = value.split(" ");
    if (scheme?.toLowerCase() === "bearer") return credential;
  }
  return undefined;
}

// What every other service calls to find out who is holding a credential.
function currentCallerRoute(deps: IdentityDeps): Route {
  return {
    method: "GET",
    path: "/v1/callers/current",
    handle: async (request) => {
      const caller = await authenticate(deps.repository, bearerOf(request.headers));
      return { status: 200, body: caller };
    },
  };
}

function registerTenantRoute(deps: IdentityDeps): Route {
  return {
    method: "POST",
    path: "/v1/tenants",
    handle: async (request) => {
      const parsed = tenantBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const tenant = await registerTenant(deps, {
        name: parsed.data.name,
        countryCode: parsed.data.country_code,
        currency: parsed.data.currency,
        locale: parsed.data.locale,
        region: parsed.data.region,
      });

      return { status: 201, body: tenant };
    },
  };
}

function issueKeyRoute(deps: IdentityDeps): Route {
  return {
    method: "POST",
    path: "/v1/keys",
    handle: async (request) => {
      const parsed = keyBody.safeParse(request.body);
      if (!parsed.success) return invalid(parsed.error.issues.map((i) => i.message).join("; "));

      const key = await issueKey(deps, {
        tenantId: parsed.data.tenant_id,
        name: parsed.data.name,
        scopes: parsed.data.scopes,
      });

      // The secret appears here and nowhere else, ever again.
      return {
        status: 201,
        body: { ...key, warning: "store this secret now; it cannot be shown again" },
      };
    },
  };
}

function listKeysRoute(deps: IdentityDeps): Route {
  return {
    method: "GET",
    path: "/v1/tenants/:id/keys",
    handle: async (request) => {
      const keys = await listKeys(deps, request.params["id"] ?? "");
      return {
        status: 200,
        body: keys.map((key) => ({
          id: key.id,
          name: key.name,
          scopes: key.scopes,
          fingerprint: key.fingerprint,
          revoked: key.revokedAt !== undefined,
        })),
      };
    },
  };
}

function revokeKeyRoute(deps: IdentityDeps): Route {
  return {
    method: "POST",
    path: "/v1/keys/:id/revoke",
    handle: async (request) => {
      const tenantId = z.object({ tenant_id: z.string().min(1) }).safeParse(request.body);
      if (!tenantId.success) return invalid("tenant_id is required");

      await revokeKey(deps, tenantId.data.tenant_id, request.params["id"] ?? "");
      return { status: 200, body: { revoked: true } };
    },
  };
}

function readTenantRoute(deps: IdentityDeps): Route {
  return {
    method: "GET",
    path: "/v1/tenants/:id",
    handle: async (request) => {
      const tenant = await deps.repository.tenantById(request.params["id"] ?? "");
      if (tenant === undefined)
        throw new DomainError("not_found", "no tenant with that identifier");
      return { status: 200, body: tenant };
    },
  };
}

export function identityRoutes(deps: IdentityDeps): Route[] {
  return [
    currentCallerRoute(deps),
    registerTenantRoute(deps),
    issueKeyRoute(deps),
    listKeysRoute(deps),
    revokeKeyRoute(deps),
    readTenantRoute(deps),
  ];
}
