import {
  badRequest,
  created,
  notFound,
  ok,
  unauthorized,
  type ServiceSurface,
} from "@runsheet/api";
import { keyBody, tenantBody } from "./routes.js";

export const identitySurface: ServiceSurface = {
  service: "identity",
  operations: [
    {
      method: "POST",
      path: "/v1/tenants",
      summary: "Create a tenant",
      request: tenantBody,
      replies: [created("the tenant"), badRequest],
    },
    {
      method: "GET",
      path: "/v1/tenants/:id",
      summary: "Read a tenant",
      replies: [ok("the tenant"), notFound],
    },
    {
      method: "POST",
      path: "/v1/keys",
      summary: "Issue an API key. The secret is shown once and never again",
      request: keyBody,
      replies: [created("the key and its secret"), badRequest, notFound],
    },
    {
      method: "GET",
      path: "/v1/tenants/:id/keys",
      summary: "List a tenant's keys without their secrets",
      replies: [ok("the keys"), notFound],
    },
    {
      method: "POST",
      path: "/v1/keys/:id/revoke",
      summary: "Revoke a key at once",
      replies: [ok("the key is revoked"), badRequest, notFound],
    },
    {
      method: "GET",
      path: "/v1/callers/current",
      summary: "Report who the presented credential belongs to",
      replies: [ok("the caller, its tenant and its scopes"), unauthorized],
    },
  ],
};
