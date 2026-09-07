import { describe, expect, it } from "vitest";
import { newTraceContext, parseTraceparent, toTraceparent } from "./trace.js";

describe("trace context", () => {
  it("reads a w3c traceparent header", () => {
    const header = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    const context = parseTraceparent(header);

    expect(context).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      parentId: "00f067aa0ba902b7",
      sampled: true,
    });
  });

  it("reads the sampled flag as off", () => {
    const context = parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00");

    expect(context?.sampled).toBe(false);
  });

  it("rejects a header that is malformed or an unsupported version", () => {
    expect(parseTraceparent("nonsense")).toBeUndefined();
    expect(
      parseTraceparent("99-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
    ).toBeUndefined();
    expect(
      parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"),
    ).toBeUndefined();
    expect(
      parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01"),
    ).toBeUndefined();
  });

  it("ignores an unreadable incoming header and starts fresh", () => {
    const context = newTraceContext("not-a-traceparent");

    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.sampled).toBe(true);
  });

  it("carries an unsampled decision through a continued trace", () => {
    const context = newTraceContext("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00");

    expect(context.sampled).toBe(false);
    expect(toTraceparent(context).endsWith("-00")).toBe(true);
  });

  it("starts a new trace when there is no incoming header", () => {
    const context = newTraceContext(undefined);

    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.parentId).toMatch(/^[0-9a-f]{16}$/);
    expect(context.sampled).toBe(true);
  });

  it("continues an incoming trace with a fresh span", () => {
    const header = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    const context = newTraceContext(header);

    expect(context.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(context.parentId).not.toBe("00f067aa0ba902b7");
  });

  it("writes a header a downstream service can read back", () => {
    const context = newTraceContext(undefined);

    expect(parseTraceparent(toTraceparent(context))).toEqual(context);
  });
});
