import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { issueToken, readToken } from "./token.js";

const secret = "a-secret-at-least-thirty-two-characters";
const issuedAt = new Date("2026-09-07T10:00:00.000Z");

describe("a tracking link", () => {
  it("opens exactly one consignment", () => {
    const token = issueToken({
      consignmentId: "c-1",
      tenantId: "t-1",
      secret,
      issuedAt,
      validHours: 168,
    });

    expect(readToken(token, secret, issuedAt)).toMatchObject({
      consignmentId: "c-1",
      tenantId: "t-1",
    });
  });

  it("cannot be read with a different secret", () => {
    const token = issueToken({
      consignmentId: "c-1",
      tenantId: "t-1",
      secret,
      issuedAt,
      validHours: 168,
    });

    expect(readToken(token, "some-other-secret-of-sufficient-length", issuedAt)).toBeUndefined();
  });

  it("cannot be edited to point at another consignment", () => {
    const token = issueToken({
      consignmentId: "c-1",
      tenantId: "t-1",
      secret,
      issuedAt,
      validHours: 168,
    });
    const [payload, signature] = token.split(".");
    const tampered = `${Buffer.from('{"c":"c-2","t":"t-1","e":9999999999}').toString("base64url")}.${signature ?? ""}`;

    expect(payload).toBeDefined();
    expect(readToken(tampered, secret, issuedAt)).toBeUndefined();
  });

  it("stops working once it expires", () => {
    const token = issueToken({
      consignmentId: "c-1",
      tenantId: "t-1",
      secret,
      issuedAt,
      validHours: 1,
    });

    expect(readToken(token, secret, new Date("2026-09-07T10:59:00.000Z"))).toBeDefined();
    expect(readToken(token, secret, new Date("2026-09-07T11:01:00.000Z"))).toBeUndefined();
  });

  it("refuses nonsense rather than throwing", () => {
    expect(readToken("not-a-token", secret, issuedAt)).toBeUndefined();
    expect(readToken("", secret, issuedAt)).toBeUndefined();
    expect(readToken("a.b.c", secret, issuedAt)).toBeUndefined();
  });

  it("refuses a correctly signed token whose payload is not readable", () => {
    // Signed properly, so it gets past the signature check and exercises the parsing guard.
    const encoded = Buffer.from("not json at all").toString("base64url");
    const signature = createHmac("sha256", secret).update(encoded).digest("base64url");

    expect(readToken(`${encoded}.${signature}`, secret, issuedAt)).toBeUndefined();
  });

  it("refuses a signature of the wrong length without comparing it", () => {
    const token = issueToken({
      consignmentId: "c-1",
      tenantId: "t-1",
      secret,
      issuedAt,
      validHours: 1,
    });
    const encoded = token.slice(0, token.indexOf("."));

    expect(readToken(`${encoded}.short`, secret, issuedAt)).toBeUndefined();
    expect(readToken(`${encoded}.`, secret, issuedAt)).toBeUndefined();
  });

  it("refuses to be issued with a weak secret", () => {
    expect(() =>
      issueToken({ consignmentId: "c", tenantId: "t", secret: "short", issuedAt, validHours: 1 }),
    ).toThrow("the signing secret is too short to be safe");
  });

  it("is different for every consignment, so one link never reveals another", () => {
    const first = issueToken({ consignmentId: "c-1", tenantId: "t-1", secret, issuedAt, validHours: 1 });
    const second = issueToken({ consignmentId: "c-2", tenantId: "t-1", secret, issuedAt, validHours: 1 });

    expect(first).not.toBe(second);
  });
});
