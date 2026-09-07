// One way to call the platform. Every request carries the key, every reply is read the same way,
// and every failure becomes a value with the platform's own error shape, never a thrown string.

export interface ApiError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly traceparent?: string;
}

export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiError };

export interface Api {
  get<T>(path: string): Promise<ApiResult<T>>;
  post<T>(path: string, body: unknown): Promise<ApiResult<T>>;
  file(path: string): Promise<ApiResult<{ text: string; filename: string }>>;
}

export interface ApiOptions {
  readonly key: () => string | undefined;
  readonly fetch?: typeof globalThis.fetch;
  readonly base?: string;
}

function isErrorShape(body: unknown): body is { error: { code: string; message: string } } {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object"
  );
}

async function readFailure(response: Response): Promise<ApiError> {
  const traceparent = response.headers.get("traceparent") ?? undefined;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const shaped = isErrorShape(body)
    ? body.error
    : { code: "unreadable_reply", message: `the platform answered ${String(response.status)}` };
  return { status: response.status, ...shaped, ...(traceparent === undefined ? {} : { traceparent }) };
}

function unreachable(): ApiError {
  return { status: 0, code: "unreachable", message: "could not reach the platform" };
}

function filenameOf(response: Response): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return match?.[1] ?? "download";
}

export function createApi(options: ApiOptions): Api {
  const call = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.base ?? "";

  const headers = (): Record<string, string> => {
    const key = options.key();
    return {
      accept: "application/json",
      ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
    };
  };

  async function send<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
    let response: Response;
    try {
      response = await call(`${base}${path}`, init);
    } catch {
      return { ok: false, error: unreachable() };
    }
    if (!response.ok) return { ok: false, error: await readFailure(response) };
    return { ok: true, value: (await response.json()) as T };
  }

  return {
    get: (path) => send(path, { headers: headers() }),
    post: (path, body) =>
      send(path, {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    async file(path) {
      let response: Response;
      try {
        response = await call(`${base}${path}`, { headers: headers() });
      } catch {
        return { ok: false, error: unreachable() };
      }
      if (!response.ok) return { ok: false, error: await readFailure(response) };
      return { ok: true, value: { text: await response.text(), filename: filenameOf(response) } };
    },
  };
}
