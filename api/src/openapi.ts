import { z } from "zod";
import type { Operation, Reply, ServiceSurface } from "./surface.js";

const SECURITY_SCHEME = "apiKey";

export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: { readonly title: string; readonly version: string };
  readonly components: Record<string, unknown>;
  readonly paths: Record<string, Record<string, unknown>>;
}

// OpenAPI writes a path parameter as {name}; the router writes it as :name.
function toTemplate(path: string): string {
  return path
    .split("/")
    .map((part) => (part.startsWith(":") ? `{${part.slice(1)}}` : part))
    .join("/");
}

function parametersOf(path: string): Record<string, unknown>[] {
  return path
    .split("/")
    .filter((part) => part.startsWith(":"))
    .map((part) => ({
      name: part.slice(1),
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
}

function bodyOf(operation: Operation): Record<string, unknown> | undefined {
  if (operation.request === undefined) return undefined;
  return {
    required: true,
    content: { "application/json": { schema: z.toJSONSchema(operation.request) } },
  };
}

function responseOf(reply: Reply): Record<string, unknown> {
  return {
    description: reply.description,
    ...(reply.schema === undefined
      ? {}
      : { content: { "application/json": { schema: z.toJSONSchema(reply.schema) } } }),
  };
}

function operationOf(service: string, operation: Operation): Record<string, unknown> {
  const body = bodyOf(operation);
  const parameters = parametersOf(operation.path);

  return {
    tags: [service],
    summary: operation.summary,
    operationId: `${operation.method.toLowerCase()}${toTemplate(operation.path)
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
      .replace(/^./, (c) => c.toUpperCase())}`,
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(body === undefined ? {} : { requestBody: body }),
    responses: Object.fromEntries(
      operation.replies.map((reply) => [String(reply.status), responseOf(reply)]),
    ),
    security: operation.scope === undefined ? [] : [{ [SECURITY_SCHEME]: [operation.scope] }],
  };
}

export function openApiDocument(
  surfaces: readonly ServiceSurface[],
  version: string,
): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const surface of surfaces) {
    for (const operation of surface.operations) {
      const template = toTemplate(operation.path);
      paths[template] = {
        ...paths[template],
        [operation.method.toLowerCase()]: operationOf(surface.service, operation),
      };
    }
  }

  return {
    openapi: "3.1.0",
    info: { title: "Runsheet", version },
    components: {
      securitySchemes: {
        [SECURITY_SCHEME]: {
          type: "http",
          scheme: "bearer",
          description: "An API key issued to a tenant. The tenant comes from the key, never from a header.",
        },
      },
    },
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
  };
}
