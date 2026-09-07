import { describe, expect, it } from "vitest";
import { rateLimiter } from "./rate-limit.js";

describe("limiting how fast a caller may go", () => {
  it("allows requests inside the allowance", () => {
    const limiter = rateLimiter({ perMinute: 3, now: () => 0 });

    expect(limiter.check("caller-1").allowed).toBe(true);
    expect(limiter.check("caller-1").allowed).toBe(true);
    expect(limiter.check("caller-1").allowed).toBe(true);
  });

  it("refuses once the allowance is spent", () => {
    const limiter = rateLimiter({ perMinute: 2, now: () => 0 });
    limiter.check("caller-1");
    limiter.check("caller-1");

    const refused = limiter.check("caller-1");

    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("refills as time passes rather than blocking for a whole minute", () => {
    let clock = 0;
    const limiter = rateLimiter({ perMinute: 60, now: () => clock });
    for (let i = 0; i < 60; i += 1) limiter.check("caller-1");
    expect(limiter.check("caller-1").allowed).toBe(false);

    clock += 2000;

    expect(limiter.check("caller-1").allowed).toBe(true);
  });

  it("counts each caller separately", () => {
    const limiter = rateLimiter({ perMinute: 1, now: () => 0 });
    limiter.check("caller-1");

    expect(limiter.check("caller-2").allowed).toBe(true);
  });

  it("says how much allowance is left, so a client can slow down before it is refused", () => {
    const limiter = rateLimiter({ perMinute: 10, now: () => 0 });

    expect(limiter.check("caller-1").remaining).toBe(9);
    expect(limiter.check("caller-1").remaining).toBe(8);
  });

  it("never lets an idle caller bank more than the allowance", () => {
    let clock = 0;
    const limiter = rateLimiter({ perMinute: 5, now: () => clock });

    clock += 3_600_000;

    for (let i = 0; i < 5; i += 1) expect(limiter.check("caller-1").allowed).toBe(true);
    expect(limiter.check("caller-1").allowed).toBe(false);
  });

  it("forgets a caller who has not been seen for a long time, so memory does not grow forever", () => {
    let clock = 0;
    const limiter = rateLimiter({ perMinute: 5, now: () => clock, forgetAfterMs: 60_000 });
    limiter.check("caller-1");

    clock += 120_000;
    limiter.check("caller-2");

    expect(limiter.size()).toBe(1);
  });
});
