import type { z } from "zod";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Reply {
  readonly status: number;
  readonly description: string;
  readonly schema?: z.ZodType;
}

export interface Operation {
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  /** The scope a caller's key must carry. Absent means the route is open. */
  readonly scope?: string;
  readonly request?: z.ZodType;
  readonly replies: readonly Reply[];
}

// Every service describes its own routes with the same schemas its handlers validate against,
// so the published specification cannot describe a request the service would reject.
export interface ServiceSurface {
  readonly service: string;
  readonly operations: readonly Operation[];
}

export const ok = (description: string, schema?: z.ZodType): Reply => ({
  status: 200,
  description,
  ...(schema === undefined ? {} : { schema }),
});

export const created = (description: string, schema?: z.ZodType): Reply => ({
  status: 201,
  description,
  ...(schema === undefined ? {} : { schema }),
});

export const badRequest: Reply = { status: 400, description: "the request did not validate" };
export const unauthorized: Reply = { status: 401, description: "no usable credential" };
export const forbidden: Reply = { status: 403, description: "the key lacks the scope" };
export const notFound: Reply = { status: 404, description: "no such resource" };
export const conflict: Reply = { status: 409, description: "the change is not allowed from here" };
