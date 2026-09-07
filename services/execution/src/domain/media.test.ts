import { describe, expect, it } from "vitest";
import { accept, declare, overdue, type MediaRecord } from "./media.js";

const at = new Date("2026-09-07T18:00:00.000Z");
const hash = "a".repeat(64);

const declared = (): MediaRecord =>
  declare({
    mediaId: "m-1",
    tenantId: "t",
    eventId: "e-1",
    sha256: hash,
    bytes: 120_000,
    kind: "photo",
    at,
  });

describe("declaring media a device is holding", () => {
  it("records it as wanted before a byte has moved", () => {
    expect(declared().uploadedAt).toBeUndefined();
    expect(declared().sha256).toBe(hash);
  });

  it("refuses a hash that is not a hash, because it is the only thing verifying the bytes", () => {
    expect(() => declare({ ...declared(), sha256: "nope", at })).toThrow(
      "that is not a sha256 hash",
    );
  });

  it("refuses an empty file", () => {
    expect(() => declare({ ...declared(), bytes: 0, at })).toThrow("declared media has no bytes");
  });

  it("refuses a file larger than a handset should ever send", () => {
    expect(() => declare({ ...declared(), bytes: 51_000_000, at })).toThrow(
      "that file is too large for a proof",
    );
  });
});

describe("accepting the bytes when they arrive", () => {
  it("marks it uploaded when the bytes hash to what was promised", () => {
    const accepted = accept(declared(), hash, at);

    expect(accepted.uploadedAt).toEqual(at);
  });

  it("refuses bytes that hash to something else, because they are not the proof", () => {
    expect(() => accept(declared(), "b".repeat(64), at)).toThrow(
      "those bytes are not what was declared",
    );
  });

  it("takes the same upload twice without complaint, so a device may retry forever", () => {
    const once = accept(declared(), hash, at);
    const twice = accept(once, hash, new Date("2026-09-07T19:00:00.000Z"));

    expect(twice.uploadedAt).toEqual(at);
  });
});

describe("media that never arrives", () => {
  const day = 24 * 3_600_000;

  it("is not overdue on the day it was declared", () => {
    expect(overdue(declared(), new Date(at.getTime() + day - 1))).toBe(false);
  });

  it("is overdue a day later", () => {
    expect(overdue(declared(), new Date(at.getTime() + day + 1))).toBe(true);
  });

  it("is never overdue once it has arrived", () => {
    const accepted = accept(declared(), hash, at);

    expect(overdue(accepted, new Date(at.getTime() + 10 * day))).toBe(false);
  });
});
