import { describe, expect, it, vi } from "vitest";
import { attemptsFor, deliver, nextAttemptAt } from "./delivery.js";

const at = new Date("2026-09-07T10:00:00.000Z");
const endpoint = {
  url: "http://customer.test/hook",
  secrets: ["a-webhook-secret-of-sufficient-length"],
};
const event = { id: "e-1", type: "consignment.delivered", payload: { id: "c-1" } };

// A 204 may not carry a body, so the helper honours that rather than building an invalid one.
const NO_BODY = new Set([204, 205, 304]);

function respondingWith(status: number): typeof globalThis.fetch {
  return vi.fn(() => Promise.resolve(new Response(NO_BODY.has(status) ? null : "", { status })));
}

describe("delivering a webhook", () => {
  it("reports success when the receiver accepts it", async () => {
    const result = await deliver({ endpoint, event, at, fetch: respondingWith(200) });

    expect(result).toMatchObject({ delivered: true, attempt: 1 });
  });

  it("treats any two hundred as accepted", async () => {
    expect((await deliver({ endpoint, event, at, fetch: respondingWith(204) })).delivered).toBe(
      true,
    );
  });

  it("signs what it sends, so the receiver can check it came from us", async () => {
    const call = respondingWith(200);

    await deliver({ endpoint, event, at, fetch: call });

    const headers = vi.mocked(call).mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["runsheet-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(headers["runsheet-event-id"]).toBe("e-1");
  });

  it("reports a failure the receiver caused, and that it is worth retrying", async () => {
    const result = await deliver({ endpoint, event, at, fetch: respondingWith(503) });

    expect(result).toMatchObject({ delivered: false, retryable: true, status: 503 });
  });

  it("does not retry a receiver that says the request itself is wrong", async () => {
    const result = await deliver({ endpoint, event, at, fetch: respondingWith(400) });

    expect(result).toMatchObject({ delivered: false, retryable: false });
  });

  it("retries a receiver that is rate limiting us", async () => {
    expect((await deliver({ endpoint, event, at, fetch: respondingWith(429) })).retryable).toBe(
      true,
    );
  });

  it("reports an unreachable receiver as worth retrying", async () => {
    const result = await deliver({
      endpoint,
      event,
      at,
      fetch: vi.fn(() => Promise.reject(new Error("connection refused"))),
    });

    expect(result).toMatchObject({ delivered: false, retryable: true });
    expect(result.error).toContain("connection refused");
  });
});

describe("a badly configured endpoint", () => {
  it("says the secret is the problem rather than blaming the receiver", async () => {
    await expect(
      deliver({
        endpoint: { url: "http://customer.test/hook", secrets: ["short"] },
        event,
        at,
        fetch: respondingWith(200),
      }),
    ).rejects.toThrow("a webhook secret is too short to be safe");
  });
});

describe("edge cases in delivery", () => {
  it("counts the attempt it was told it is on", async () => {
    const result = await deliver({ endpoint, event, at, attempt: 4, fetch: respondingWith(200) });

    expect(result.attempt).toBe(4);
  });

  it("reports something thrown that is not an error", async () => {
    const result = await deliver({
      endpoint,
      event,
      at,
      // A client library that rejects with something other than an Error; the result must still
      // be readable rather than crashing the delivery loop.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      fetch: vi.fn(() => Promise.reject("just a string")),
    });

    expect(result.error).toBe("unknown");
  });
});

describe("when to try again", () => {
  it("backs off further each time", () => {
    const after = (attempt: number): number => {
      const next = nextAttemptAt(attempt, at);
      if (next === undefined) throw new Error(`attempt ${String(attempt)} should be retried`);
      return next.getTime() - at.getTime();
    };
    const [first, second, third] = [after(1), after(2), after(3)];

    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("keeps trying for about a day, so an outage overnight is survivable", () => {
    const last = nextAttemptAt(attemptsFor(), at);

    expect(last).toBeDefined();
    expect((last?.getTime() ?? 0) - at.getTime()).toBeGreaterThan(20 * 3_600_000);
  });

  it("stops after the last attempt rather than trying forever", () => {
    expect(nextAttemptAt(attemptsFor() + 1, at)).toBeUndefined();
  });
});
