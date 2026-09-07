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

const repository: ReportingRepository = {
  run: (report) =>
    Promise.resolve({
      columns: headerOf(report),
      rows: [{ day: "2026-09-07", hub_id: "BLR1", delivered: 40, attempted: 8, returned: 1 }],
    }),
};

let router: ReturnType<typeof createRouter>;

beforeEach(() => {
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
