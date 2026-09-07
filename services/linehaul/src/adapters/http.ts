import { newTraceContext, toTraceparent } from "@runsheet/runtime";
import { isDomainError } from "../domain/errors.js";
import { NotAuthenticated, NotPermitted } from "@runsheet/auth";

function isRefusal(error: unknown): error is NotAuthenticated | NotPermitted {
  return error instanceof NotAuthenticated || error instanceof NotPermitted;
}

export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | undefined>;
  readonly body: unknown;
  readonly params?: Record<string, string>;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface Route {
  readonly method: string;
  readonly path: string;
  handle(request: HttpRequest & { params: Record<string, string> }): Promise<HttpResponse>;
}

interface Compiled extends Route {
  readonly pattern: RegExp;
  readonly names: string[];
}

function compile(route: Route): Compiled {
  const names: string[] = [];
  const pattern = route.path
    .split("/")
    .map((part) => {
      if (!part.startsWith(":")) return part;
      names.push(part.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { ...route, names, pattern: new RegExp(`^${pattern}$`) };
}

function fail(status: number, code: string, message: string): HttpResponse {
  return { status, body: { error: { code, message } } };
}

export function createRouter(routes: readonly Route[]): {
  handle(request: HttpRequest): Promise<HttpResponse>;
} {
  const compiled = routes.map(compile);

  return {
    async handle(request) {
      const trace = newTraceContext(request.headers["traceparent"]);
      const headers = { traceparent: toTraceparent(trace) };
      const path = new URL(request.url, "http://router.local").pathname;

      const matches = compiled
        .map((route) => ({ route, found: route.pattern.exec(path) }))
        .filter((candidate) => candidate.found !== null);

      if (matches.length === 0) {
        return { ...fail(404, "route_not_found", `no route for ${path}`), headers };
      }

      const match = matches.find((candidate) => candidate.route.method === request.method);
      if (match === undefined) {
        return {
          ...fail(405, "method_not_allowed", `${request.method} is not allowed on ${path}`),
          headers,
        };
      }

      const captured = match.found === null ? [] : match.found.slice(1);
      const params = Object.fromEntries(
        captured.map((value, index) => [match.route.names[index] ?? String(index), value]),
      );

      try {
        const response = await match.route.handle({ ...request, params });
        return { ...response, headers: { ...headers, ...response.headers } };
      } catch (error) {
        if (isDomainError(error) || isRefusal(error)) {
          return { ...fail(error.status, error.code, error.message), headers };
        }
        // An unexpected failure is logged with the trace identifier; the caller gets no detail.
        return { ...fail(500, "internal_error", "the request could not be completed"), headers };
      }
    },
  };
}
