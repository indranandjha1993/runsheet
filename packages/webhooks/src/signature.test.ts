import { describe, expect, it } from "vitest";
import { sign, verify } from "./signature.js";

const secret = "a-webhook-secret-of-sufficient-length";
const body = '{"type":"consignment.delivered"}';
const at = new Date("2026-09-07T10:00:00.000Z");

describe("signing a webhook", () => {
  it("produces a header a receiver can check", () => {
    const header = sign(body, [secret], at);

    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it("verifies its own signature", () => {
    expect(verify(body, sign(body, [secret], at), [secret], at)).toBe(true);
  });

  it("refuses a body that was changed in flight", () => {
    const header = sign(body, [secret], at);

    expect(verify('{"type":"consignment.lost"}', header, [secret], at)).toBe(false);
  });

  it("refuses a signature made with a different secret", () => {
    const header = sign(body, ["another-secret-of-sufficient-length"], at);

    expect(verify(body, header, [secret], at)).toBe(false);
  });

  it("accepts either secret during a rotation, so nothing breaks mid-change", () => {
    const old = "the-previous-secret-of-enough-length";
    const header = sign(body, [old], at);

    expect(verify(body, header, [secret, old], at)).toBe(true);
  });

  it("refuses a signature too old to be genuine, so nobody can replay one", () => {
    const header = sign(body, [secret], at);
    const muchLater = new Date("2026-09-07T10:10:00.000Z");

    expect(verify(body, header, [secret], muchLater)).toBe(false);
  });

  it("accepts one inside the tolerance, because clocks differ", () => {
    const header = sign(body, [secret], at);
    const slightlyLater = new Date("2026-09-07T10:02:00.000Z");

    expect(verify(body, header, [secret], slightlyLater)).toBe(true);
  });

  it("refuses a header that is not a signature at all", () => {
    expect(verify(body, "nonsense", [secret], at)).toBe(false);
    expect(verify(body, "t=abc,v1=def", [secret], at)).toBe(false);
    expect(verify(body, "", [secret], at)).toBe(false);
  });

  it("refuses to sign when no secret was given at all", () => {
    expect(() => sign(body, [], at)).toThrow("a webhook secret is too short to be safe");
  });

  it("refuses a secret too short to be safe", () => {
    expect(() => sign(body, ["short"], at)).toThrow("a webhook secret is too short to be safe");
  });
});
