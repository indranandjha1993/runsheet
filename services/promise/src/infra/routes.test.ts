import { beforeEach, describe, expect, it } from "vitest";
import { createRouter } from "../adapters/http.js";
import { promiseRoutes } from "./routes.js";
import {
  countingIds,
  fixedClock,
  inMemoryPromises,
  recordingMessenger,
  recordingPublisher,
} from "../application/test-doubles.js";

const tenantId = "01J8Z0T0000000000000000002";
const consignmentId = "01J8Z0T0000000000000000003";
const tenant = { authorization: "Bearer rsk_test" };
const secret = "a-signing-secret-of-sufficient-length";

const lookup = (
  presented: string,
): Promise<
  { tenantId: string; keyId: string; fingerprint: string; scopes: string[] } | undefined
> =>
  Promise.resolve(
    presented === "rsk_test"
      ? { tenantId, keyId: "k1", fingerprint: "abc123def456", scopes: ["consignments:write"] }
      : undefined,
  );

let router: ReturnType<typeof createRouter>;
let messenger: ReturnType<typeof recordingMessenger>;

beforeEach(() => {
  messenger = recordingMessenger();
  router = createRouter(
    promiseRoutes({
      lookup,
      repository: inMemoryPromises(),
      messenger,
      publisher: recordingPublisher(),
      clock: fixedClock("2026-09-07T10:00:00.000Z"),
      ids: countingIds(),
      signingSecret: secret,
      trackingValidHours: 168,
    }),
  );
});

const post = (
  url: string,
  body: unknown,
  headers: Record<string, string> = tenant,
): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "POST", url, headers, body });

const get = (url: string, headers = {}): Promise<{ status: number; body: unknown }> =>
  router.handle({ method: "GET", url, headers, body: undefined });

const promiseBody = {
  consignment_id: consignmentId,
  window_start: "2026-09-07T14:00:00.000Z",
  window_end: "2026-09-07T16:00:00.000Z",
};

async function promised(): Promise<string> {
  const response = await post("/v1/promises", promiseBody);
  return (response.body as { tracking_token: string }).tracking_token;
}

describe("promising over the api", () => {
  it("returns the promise and a tracking link", async () => {
    const response = await post("/v1/promises", promiseBody);

    expect(response.status).toBe(201);
    expect((response.body as { tracking_token: string }).tracking_token).toContain(".");
  });

  it("refuses a window in the past", async () => {
    const response = await post("/v1/promises", {
      ...promiseBody,
      window_start: "2026-09-06T14:00:00.000Z",
      window_end: "2026-09-06T16:00:00.000Z",
    });

    expect(response.status).toBe(400);
  });

  it("refuses a malformed request", async () => {
    expect((await post("/v1/promises", { consignment_id: "" })).status).toBe(400);
  });

  it("refuses a request with no credential", async () => {
    expect((await post("/v1/promises", promiseBody, {})).status).toBe(401);
  });
});

describe("reporting an estimate over the api", () => {
  it("stays quiet when the parcel is on time", async () => {
    await promised();

    await post(`/v1/promises/${consignmentId}/eta`, { eta: "2026-09-07T15:00:00.000Z" });

    expect(messenger.sent).toHaveLength(0);
  });

  it("messages the customer when it is running late", async () => {
    await promised();

    const response = await post(`/v1/promises/${consignmentId}/eta`, {
      eta: "2026-09-07T18:00:00.000Z",
    });

    expect(response.body).toMatchObject({ atRisk: true });
    expect(messenger.sent).toHaveLength(1);
  });

  it("writes in the language asked for", async () => {
    await promised();

    await post(`/v1/promises/${consignmentId}/eta`, {
      eta: "2026-09-07T18:00:00.000Z",
      locale: "hi-IN",
    });

    expect(messenger.sent[0]?.locale).toBe("hi-IN");
  });

  it("refuses a malformed estimate", async () => {
    await promised();

    expect((await post(`/v1/promises/${consignmentId}/eta`, { eta: "soon" })).status).toBe(400);
  });

  it("reports a consignment nothing was promised for", async () => {
    expect((await post("/v1/promises/nope/eta", { eta: "2026-09-07T18:00:00.000Z" })).status).toBe(
      404,
    );
  });
});

describe("settling over the api", () => {
  it("tells the customer it arrived", async () => {
    await promised();

    const response = await post(`/v1/promises/${consignmentId}/settle`, {
      milestone: "delivered",
    });

    expect(response.body).toMatchObject({ settled: true });
    expect(messenger.sent[0]?.text).toContain("delivered");
  });

  it("tells the customer why an attempt failed", async () => {
    await promised();

    await post(`/v1/promises/${consignmentId}/settle`, {
      milestone: "attempted",
      reason: "nobody was home",
    });

    expect(messenger.sent[0]?.text).toContain("nobody was home");
  });

  it("refuses a malformed settlement", async () => {
    await promised();

    expect((await post(`/v1/promises/${consignmentId}/settle`, {})).status).toBe(400);
  });
});

describe("the tracking link", () => {
  it("opens without any credential at all", async () => {
    const token = await promised();

    const response = await get(`/track/${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "on_track" });
  });

  it("shows nothing that identifies anybody", async () => {
    const token = await promised();

    const response = await get(`/track/${token}`);

    expect(Object.keys(response.body as object)).toEqual([
      "status",
      "windowStart",
      "windowEnd",
      "estimatedArrival",
      "lastMilestone",
    ]);
  });

  it("is never cached, because the answer changes", async () => {
    const token = await promised();

    expect((await get(`/track/${token}`)).status).toBe(200);
    expect(
      (
        await router.handle({
          method: "GET",
          url: `/track/${token}`,
          headers: {},
          body: undefined,
        })
      ).headers?.["cache-control"],
    ).toBe("no-store");
  });

  it("refuses a link that was tampered with", async () => {
    const token = await promised();

    expect((await get(`/track/${token}x`)).status).toBe(404);
  });

  it("refuses a link that is not a link", async () => {
    expect((await get("/track/nonsense")).status).toBe(404);
  });
});
