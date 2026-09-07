import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { reportingRoutes } from "./routes.js";
import type { ReportingRepository } from "../application/ports.js";
import { headerOf } from "../domain/reports.js";

const tenantId = "01J8Z0T0000000000000000002";
const tenant = { authorization: "Bearer rsk_test" };

const lookup = (
  presented: string,
): Promise<
  { tenantId: string; keyId: string; fingerprint: string; scopes: string[] } | undefined
> =>
  Promise.resolve(
    presented === "rsk_test"
      ? { tenantId, keyId: "k1", fingerprint: "abc123def456", scopes: ["reports:read"] }
      : undefined,
  );

let windows: { count: number; events: number }[] = [];

const repository: ReportingRepository = {
  countWindow: () => Promise.resolve(windows.shift() ?? { count: 2000, events: 200 }),
  run: (report) =>
    Promise.resolve({
      columns: headerOf(report),
      rows: [{ day: "2026-09-07", hub_id: "BLR1", delivered: 40, attempted: 8, returned: 1 }],
    }),
};

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
  windows = [
    { count: 2000, events: 400 },
    { count: 2000, events: 200 },
  ];
  router = createRouter(
    reportingRoutes({
      lookup,
      repository,
      clock: { now: () => new Date("2026-09-07T18:00:00.000Z") },
    }),
  );
});

const get = (
  url: string,
  headers: Record<string, string> = tenant,
): Promise<{ status: number; body: unknown; headers?: Record<string, string> }> =>
  router.handle({ method: "GET", url, headers, body: undefined });

describe("listing what can be reported on", () => {
  it("names every report and what it is for", async () => {
    const response = await get("/v1/reports");

    expect(response.status).toBe(200);
    const body = response.body as { reports: { name: string; description: string }[] };
    expect(body.reports.length).toBeGreaterThan(4);
    expect(body.reports[0]?.description.length).toBeGreaterThan(20);
  });

  it("turns away a caller with no credential", async () => {
    expect((await get("/v1/reports", {})).status).toBe(401);
  });
});

describe("running a report", () => {
  const range = "from=2026-09-01&to=2026-09-07";

  it("returns the rows with the columns they belong to", async () => {
    const response = await get(`/v1/reports/delivery_performance?${range}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      report: "delivery_performance",
      columns: ["day", "hub_id", "delivered", "attempted", "returned"],
    });
  });

  it("returns a file when a file is asked for", async () => {
    const response = await get(`/v1/reports/delivery_performance?${range}&format=csv`);

    expect(response.headers?.["content-type"]).toContain("text/csv");
    expect(String(response.body).split("\n")[0]).toBe("day,hub_id,delivered,attempted,returned");
  });

  it("names the file after the report and the range", async () => {
    const response = await get(`/v1/reports/delivery_performance?${range}&format=csv`);

    expect(response.headers?.["content-disposition"]).toContain(
      "delivery_performance-2026-09-01-to-2026-09-07.csv",
    );
  });

  it("refuses a report nobody defined", async () => {
    expect((await get(`/v1/reports/salaries?${range}`)).status).toBe(404);
  });

  it("insists on a range rather than guessing one", async () => {
    expect((await get("/v1/reports/delivery_performance")).status).toBe(400);
  });

  it("refuses a range that is not dates", async () => {
    expect((await get("/v1/reports/delivery_performance?from=x&to=y")).status).toBe(400);
  });

  it("refuses a hub that is not a hub code", async () => {
    const response = await get(`/v1/reports/delivery_performance?${range}&hub=';DROP TABLE runs`);

    expect(response.status).toBe(400);
  });

  it("refuses a range too long to export in one go", async () => {
    const response = await get("/v1/reports/delivery_performance?from=2026-01-01&to=2026-12-31");

    expect(response.status).toBe(400);
  });
});

describe("measuring against a baseline", () => {
  const range =
    "baseline_from=2026-08-01&baseline_to=2026-08-14&measured_from=2026-08-15&measured_to=2026-08-28";

  it("lists the metrics a claim can be made on", async () => {
    const response = await get("/v1/baselines/metrics");

    expect(response.status).toBe(200);
    const body = response.body as { metrics: { name: string; better_when: string }[] };
    expect(body.metrics).toHaveLength(3);
    expect(body.metrics[0]).toMatchObject({ name: "failed_attempt_rate", better_when: "lower" });
  });

  it("compares the two windows and says what it found", async () => {
    const response = await get(`/v1/baselines/comparison?metric=failed_attempt_rate&${range}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ metric: "failed_attempt_rate", verdict: "improved" });
  });

  it("refuses a metric nobody defined", async () => {
    expect((await get(`/v1/baselines/comparison?metric=profit&${range}`)).status).toBe(404);
  });

  it("refuses overlapping windows", async () => {
    const overlapping =
      "baseline_from=2026-08-01&baseline_to=2026-08-20&measured_from=2026-08-15&measured_to=2026-08-28";

    expect(
      (await get(`/v1/baselines/comparison?metric=failed_attempt_rate&${overlapping}`)).status,
    ).toBe(400);
  });

  it("insists on both windows rather than guessing one", async () => {
    expect((await get("/v1/baselines/comparison?metric=failed_attempt_rate")).status).toBe(400);
  });
});
