export type Level = "debug" | "info" | "warn" | "error";

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED = new Set([
  "phone",
  "email",
  "addressText",
  "consigneeName",
  "signature",
  "apiKey",
  "password",
  "token",
]);

export type Fields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
  withTrace(traceId: string): Logger;
}

export interface LoggerOptions {
  readonly service: string;
  readonly write?: (line: string) => void;
  readonly level?: Level;
  readonly now?: () => Date;
}

function describeError(error: Error): Fields {
  const cause = error.cause;
  return {
    name: error.name,
    message: error.message,
    ...(cause instanceof Error ? { cause: cause.message } : {}),
  };
}

function clean(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED.has(key)) out[key] = "[redacted]";
    else if (value instanceof Error) out[key] = describeError(value);
    else out[key] = value;
  }
  return out;
}

function build(options: LoggerOptions, base: Fields): Logger {
  const write =
    options.write ??
    ((line: string): void => {
      process.stdout.write(`${line}\n`);
    });
  const now = options.now ?? ((): Date => new Date());
  const floor = RANK[options.level ?? "debug"];

  const emit = (level: Level, message: string, fields: Fields = {}): void => {
    if (RANK[level] < floor) return;
    write(
      JSON.stringify({
        time: now().toISOString(),
        level,
        service: options.service,
        message,
        ...base,
        ...clean(fields),
      }),
    );
  };

  return {
    debug: (message, fields) => {
      emit("debug", message, fields);
    },
    info: (message, fields) => {
      emit("info", message, fields);
    },
    warn: (message, fields) => {
      emit("warn", message, fields);
    },
    error: (message, fields) => {
      emit("error", message, fields);
    },
    withTrace: (traceId) => build(options, { ...base, traceId }),
  };
}

export function createLogger(options: LoggerOptions): Logger {
  return build(options, {});
}
