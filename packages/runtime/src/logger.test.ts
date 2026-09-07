import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

interface Line {
  level: string;
  message: string;
  traceId?: string;
  [key: string]: unknown;
}

function capture(): { lines: Line[]; write: (line: string) => void } {
  const lines: Line[] = [];
  return { lines, write: (line) => lines.push(JSON.parse(line) as Line) };
}

describe("logger", () => {
  it("writes one json object per line with a level, message, and timestamp", () => {
    const sink = capture();
    const log = createLogger({ service: "execution", write: sink.write });

    log.info("run closed", { runId: "run-1" });

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toMatchObject({
      level: "info",
      message: "run closed",
      service: "execution",
      runId: "run-1",
    });
    expect(typeof sink.lines[0]?.["time"]).toBe("string");
  });

  it("carries the trace id onto every line written in that scope", () => {
    const sink = capture();
    const log = createLogger({ service: "execution", write: sink.write });

    const scoped = log.withTrace("trace-abc");
    scoped.info("first");
    scoped.warn("second");

    expect(sink.lines.map((line) => line.traceId)).toEqual(["trace-abc", "trace-abc"]);
  });

  it("keeps the parent logger free of the child's trace", () => {
    const sink = capture();
    const log = createLogger({ service: "execution", write: sink.write });

    log.withTrace("trace-abc").info("scoped");
    log.info("unscoped");

    expect(sink.lines[1]?.traceId).toBeUndefined();
  });

  it("serialises an error with its message, name, and cause", () => {
    const sink = capture();
    const log = createLogger({ service: "execution", write: sink.write });

    log.error("append failed", {
      error: new Error("stream position 1 already taken", { cause: new Error("duplicate key") }),
    });

    expect(sink.lines[0]?.["error"]).toMatchObject({
      name: "Error",
      message: "stream position 1 already taken",
      cause: "duplicate key",
    });
  });

  it("keeps an error with no cause readable", () => {
    const sink = capture();
    const log = createLogger({ service: "execution", write: sink.write });

    log.error("plain failure", { error: new Error("no cause here") });

    expect(sink.lines[0]?.["error"]).toEqual({ name: "Error", message: "no cause here" });
  });

  it("redacts fields that must never reach a log", () => {
    const sink = capture();
    const log = createLogger({ service: "execution", write: sink.write });

    log.info("consignment booked", {
      phone: "+919876543210",
      addressText: "12 Residency Road",
      consignmentId: "c-1",
    });

    expect(sink.lines[0]).toMatchObject({
      phone: "[redacted]",
      addressText: "[redacted]",
      consignmentId: "c-1",
    });
  });

  it("writes to standard output and stamps the clock when neither is supplied", () => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string): boolean => {
      written.push(chunk);
      return true;
    };

    try {
      createLogger({ service: "execution" }).info("default sink");
    } finally {
      process.stdout.write = original;
    }

    const line = JSON.parse(written.join("").trim()) as Line;
    expect(line.message).toBe("default sink");
    expect(Date.parse(String(line["time"]))).not.toBeNaN();
  });

  it("drops lines below the configured level", () => {
    const sink = capture();
    const log = createLogger({ service: "execution", write: sink.write, level: "warn" });

    log.debug("noisy");
    log.info("also noisy");
    log.warn("kept");

    expect(sink.lines.map((line) => line.message)).toEqual(["kept"]);
  });
});
