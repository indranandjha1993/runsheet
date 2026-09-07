import { beforeEach, describe, expect, it } from "vitest";
import { promiseDelivery, reportEta, settle, viewByToken } from "./track.js";
import {
  countingIds,
  failingMessenger,
  fixedClock,
  inMemoryPromises,
  recordingMessenger,
  recordingPublisher,
} from "./test-doubles.js";
import type { PromiseDeps } from "./ports.js";

const tenantId = "01J8Z0T0000000000000000002";
const consignmentId = "01J8Z0T0000000000000000003";
const secret = "a-signing-secret-of-sufficient-length";

let deps: PromiseDeps & {
  publisher: ReturnType<typeof recordingPublisher>;
  messenger: ReturnType<typeof recordingMessenger>;
};

beforeEach(() => {
  deps = {
    repository: inMemoryPromises(),
    messenger: recordingMessenger(),
    publisher: recordingPublisher(),
    clock: fixedClock("2026-09-07T10:00:00.000Z"),
    ids: countingIds(),
    signingSecret: secret,
    trackingValidHours: 168,
  };
});

const promise = () =>
  promiseDelivery(deps, {
    tenantId,
    consignmentId,
    windowStart: new Date("2026-09-07T14:00:00.000Z"),
    windowEnd: new Date("2026-09-07T16:00:00.000Z"),
    locale: "en-IN",
  });

const late = { tenantId, consignmentId, locale: "en-IN", channel: "whatsapp" };

describe("promising a delivery", () => {
  it("stores the window and hands back a tracking link", async () => {
    const { promise: made, trackingToken } = await promise();

    expect(made.windowStart).toEqual(new Date("2026-09-07T14:00:00.000Z"));
    expect(trackingToken).toContain(".");
    expect(deps.publisher.published[0]?.event.type).toBe("promise.updated");
  });

  it("refuses a window in the past", async () => {
    await expect(
      promiseDelivery(deps, {
        tenantId,
        consignmentId,
        windowStart: new Date("2026-09-06T14:00:00.000Z"),
        windowEnd: new Date("2026-09-06T16:00:00.000Z"),
        locale: "en-IN",
      }),
    ).rejects.toThrow(/cannot be in the past/);
  });
});

describe("keeping the customer informed", () => {
  it("says nothing when the parcel is on time", async () => {
    await promise();

    await reportEta(deps, { ...late, eta: new Date("2026-09-07T15:00:00.000Z") });

    expect(deps.messenger.sent).toHaveLength(0);
  });

  it("messages once when it is running late", async () => {
    await promise();

    await reportEta(deps, { ...late, eta: new Date("2026-09-07T18:00:00.000Z") });

    expect(deps.messenger.sent).toHaveLength(1);
    expect(deps.messenger.sent[0]?.text).toContain("18:00");
  });

  it("does not message again for a small further slip", async () => {
    await promise();
    await reportEta(deps, { ...late, eta: new Date("2026-09-07T18:00:00.000Z") });

    await reportEta(deps, { ...late, eta: new Date("2026-09-07T18:05:00.000Z") });

    expect(deps.messenger.sent).toHaveLength(1);
  });

  it("messages again when it slips materially further", async () => {
    await promise();
    await reportEta(deps, { ...late, eta: new Date("2026-09-07T18:00:00.000Z") });

    await reportEta(deps, { ...late, eta: new Date("2026-09-07T20:00:00.000Z") });

    expect(deps.messenger.sent).toHaveLength(2);
  });

  it("writes in the customer's own language", async () => {
    await promise();

    await reportEta(deps, {
      ...late,
      locale: "ar-AE",
      eta: new Date("2026-09-07T18:00:00.000Z"),
    });

    expect(deps.messenger.sent[0]?.locale).toBe("ar-AE");
    expect(deps.messenger.sent[0]?.text).not.toMatch(/^Your parcel/);
  });

  it("records a message it could not send rather than dropping it", async () => {
    await promise();
    deps = { ...deps, messenger: failingMessenger() as typeof deps.messenger };

    await reportEta(deps, { ...late, eta: new Date("2026-09-07T18:00:00.000Z") });

    const recorded = await deps.repository.notificationsFor(tenantId, consignmentId);
    expect(recorded[0]?.failedReason).toBe("provider unreachable");
    expect(deps.publisher.published.at(-1)?.event.type).toBe("notification.failed");
  });

  it("reports a consignment nothing was promised for", async () => {
    await expect(
      reportEta(deps, { ...late, eta: new Date("2026-09-07T18:00:00.000Z") }),
    ).rejects.toThrow("nothing was promised for that consignment");
  });
});

describe("settling", () => {
  it("tells the customer it arrived and stops promising anything", async () => {
    await promise();

    const settled = await settle(deps, { ...late, milestone: "delivered" });

    expect(settled.settled).toBe(true);
    expect(deps.messenger.sent[0]?.text).toContain("delivered");
  });

  it("tells the customer why an attempt failed", async () => {
    await promise();

    await settle(deps, { ...late, milestone: "attempted", reason: "nobody was home" });

    expect(deps.messenger.sent[0]?.text).toContain("nobody was home");
  });

  it("stays quiet about a later estimate once settled", async () => {
    await promise();
    await settle(deps, { ...late, milestone: "delivered" });
    deps.messenger.sent.length = 0;

    await reportEta(deps, { ...late, eta: new Date("2026-09-07T20:00:00.000Z") });

    expect(deps.messenger.sent).toHaveLength(0);
  });

  it("reports a consignment nothing was promised for", async () => {
    await expect(settle(deps, { ...late, milestone: "delivered" })).rejects.toThrow(
      "nothing was promised",
    );
  });
});

describe("what someone holding the link can see", () => {
  it("shows the window and the estimate, and nothing about anybody", async () => {
    const { trackingToken } = await promise();

    const view = await viewByToken(deps, trackingToken);

    expect(view).toMatchObject({ status: "on_track" });
    expect(Object.keys(view ?? {})).not.toContain("consignmentId");
  });

  it("shows nothing for a link that was tampered with", async () => {
    const { trackingToken } = await promise();

    expect(await viewByToken(deps, `${trackingToken}x`)).toBeUndefined();
  });

  it("shows nothing for a consignment that has since gone", async () => {
    const { trackingToken } = await promise();
    const empty = { ...deps, repository: inMemoryPromises() };

    expect(await viewByToken(empty, trackingToken)).toBeUndefined();
  });

  it("shows it is running late rather than hiding it", async () => {
    const { trackingToken } = await promise();
    await reportEta(deps, { ...late, eta: new Date("2026-09-07T18:00:00.000Z") });

    expect((await viewByToken(deps, trackingToken))?.status).toBe("running_late");
  });
});
