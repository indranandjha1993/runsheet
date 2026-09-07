import { describe, expect, it } from "vitest";
import { healthReport, type Probe } from "./health.js";

const ok = (name: string): Probe => ({ name, check: () => Promise.resolve() });
const failing = (name: string, reason: string): Probe => ({
  name,
  check: () => Promise.reject(new Error(reason)),
});

describe("health report", () => {
  it("reports ready when every probe passes", async () => {
    const report = await healthReport([ok("database"), ok("broker")]);

    expect(report.status).toBe("ready");
    expect(report.checks).toEqual([
      { name: "database", ok: true },
      { name: "broker", ok: true },
    ]);
  });

  it("reports not ready and names what failed", async () => {
    const report = await healthReport([ok("database"), failing("broker", "no leader")]);

    expect(report.status).toBe("not_ready");
    expect(report.checks[1]).toEqual({ name: "broker", ok: false, detail: "no leader" });
  });

  it("treats a probe that hangs as a failure rather than hanging the endpoint", async () => {
    const hanging: Probe = { name: "database", check: () => new Promise(() => undefined) };

    const report = await healthReport([hanging], 20);

    expect(report.status).toBe("not_ready");
    expect(report.checks[0]?.detail).toBe("timed out");
  });

  it("runs probes at the same time rather than one after another", async () => {
    const slow = (name: string): Probe => ({
      name,
      check: () => new Promise((resolve) => setTimeout(resolve, 40)),
    });
    const started = Date.now();

    await healthReport([slow("a"), slow("b"), slow("c")], 500);

    expect(Date.now() - started).toBeLessThan(110);
  });

  it("reports a probe that rejects with something other than an error", async () => {
    const odd: Probe = {
      name: "broker",
      // A third-party client may reject with something that is not an Error; the report must cope.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      check: () => Promise.reject("just a string"),
    };

    const report = await healthReport([odd]);

    expect(report.checks[0]).toEqual({ name: "broker", ok: false, detail: "just a string" });
  });

  it("is ready with no probes configured", async () => {
    expect((await healthReport([])).status).toBe("ready");
  });
});
