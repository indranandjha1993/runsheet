import { newTraceContext, toTraceparent } from "@runsheet/runtime";

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
      const path = request.url.split("?")[0] ?? request.url;

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

      const params: Record<string, string> = {};
      match.route.names.forEach((name, index) => {
        params[name] = match.found?.[index + 1] ?? "";
      });

      try {
        const response = await match.route.handle({ ...request, params });
        return { ...response, headers: { ...headers, ...response.headers } };
      } catch {
        // The cause is logged with the trace identifier; the caller gets the identifier only.
        return { ...fail(500, "internal_error", "the request could not be completed"), headers };
      }
    },
  };
}
