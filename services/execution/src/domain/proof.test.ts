import { describe, expect, it } from "vitest";
import { capture, type CaptureProofCommand } from "./proof.js";

const base: CaptureProofCommand = {
  id: "proof-1",
  tenantId: "t",
  consignmentId: "c1",
  requirement: "photo_and_otp",
  kinds: ["photo", "otp"],
  capturedAt: new Date("2026-09-07T10:00:00.000Z"),
  mediaIds: ["m1"],
  geofenceOk: true,
};

describe("capturing proof", () => {
  it("satisfies a requirement when every part is present", () => {
    expect(capture(base).satisfiesRequirement).toBe(true);
  });

  it("records that it falls short rather than refusing the delivery", () => {
    const partial = capture({ ...base, kinds: ["photo"] });

    expect(partial.satisfiesRequirement).toBe(false);
    expect(partial.kinds).toEqual(["photo"]);
  });

  it("accepts more than was asked for", () => {
    expect(capture({ ...base, kinds: ["photo", "otp", "signature"] }).satisfiesRequirement).toBe(
      true,
    );
  });

  it("treats a failed geofence as falling short of a requirement that needs it", () => {
    const away = capture({ ...base, requirement: "photo_and_geofence", kinds: ["photo"], geofenceOk: false });

    expect(away.satisfiesRequirement).toBe(false);
  });

  it("accepts a photo requirement met only by a photo", () => {
    expect(capture({ ...base, requirement: "photo", kinds: ["photo"] }).satisfiesRequirement).toBe(
      true,
    );
  });

  it("refuses a requirement nobody has defined", () => {
    expect(() => capture({ ...base, requirement: "retina_scan" })).toThrow(
      "unknown proof requirement: retina_scan",
    );
  });

  it("keeps the media identifiers so uploads can catch up later", () => {
    expect(capture({ ...base, mediaIds: ["m1", "m2"] }).mediaIds).toEqual(["m1", "m2"]);
  });

  it("refuses a photo requirement with no media at all", () => {
    expect(() => capture({ ...base, kinds: ["photo"], requirement: "photo", mediaIds: [] })).toThrow(
      "a photo proof needs at least one media reference",
    );
  });
});
