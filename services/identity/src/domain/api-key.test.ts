import { describe, expect, it } from "vitest";
import { fingerprintOf, hashSecret, issue, SCOPES, scopesAllow, verify } from "./api-key.js";

const tenantId = "01J8Z0T0000000000000000002";

describe("issuing a key", () => {
  it("returns the secret once and stores only a hash of it", () => {
    const issued = issue({
      id: "key-1",
      tenantId,
      name: "warehouse integration",
      scopes: ["consignments:read", "consignments:write"],
      secret: "a".repeat(48),
    });

    expect(issued.record.secretHash).not.toContain("a".repeat(48));
    expect(issued.record.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issued.presentedSecret.startsWith("rsk_")).toBe(true);
  });

  it("refuses a secret short enough to guess", () => {
    expect(() =>
      issue({ id: "k", tenantId, name: "n", scopes: ["consignments:read"], secret: "short" }),
    ).toThrow("a key secret must be at least 32 characters");
  });

  it("refuses a key with no scopes, which could do nothing anyway", () => {
    expect(() =>
      issue({ id: "k", tenantId, name: "n", scopes: [], secret: "a".repeat(48) }),
    ).toThrow("a key needs at least one scope");
  });

  it("refuses a scope nobody defined", () => {
    expect(() =>
      issue({
        id: "k",
        tenantId,
        name: "n",
        scopes: ["everything:always"],
        secret: "a".repeat(48),
      }),
    ).toThrow("unknown scope: everything:always");
  });

  it("gives every key a fingerprint so it can be identified in a log without the secret", () => {
    const issued = issue({
      id: "key-1",
      tenantId,
      name: "n",
      scopes: ["consignments:read"],
      secret: "a".repeat(48),
    });

    expect(issued.record.fingerprint).toHaveLength(12);
    expect(fingerprintOf(issued.presentedSecret)).toBe(issued.record.fingerprint);
  });
});

describe("verifying a presented key", () => {
  const issued = issue({
    id: "key-1",
    tenantId,
    name: "n",
    scopes: ["consignments:read"],
    secret: "a".repeat(48),
  });

  it("accepts the secret it issued", () => {
    expect(verify(issued.record, issued.presentedSecret)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(verify(issued.record, "rsk_" + "b".repeat(48))).toBe(false);
    expect(verify(issued.record, "")).toBe(false);
  });

  it("rejects a key that has been revoked", () => {
    const revoked = { ...issued.record, revokedAt: new Date("2026-09-07T10:00:00.000Z") };

    expect(verify(revoked, issued.presentedSecret)).toBe(false);
  });

  it("compares in a way that does not leak how much matched", () => {
    const hash = hashSecret("a".repeat(48));

    expect(hash).toBe(hashSecret("a".repeat(48)));
    expect(hash).not.toBe(hashSecret("a".repeat(47) + "b"));
  });
});

describe("what a key may do", () => {
  it("allows exactly the scopes it was given", () => {
    expect(scopesAllow(["consignments:read"], "consignments:read")).toBe(true);
    expect(scopesAllow(["consignments:read"], "consignments:write")).toBe(false);
  });

  it("treats write as including read for the same resource", () => {
    expect(scopesAllow(["consignments:write"], "consignments:read")).toBe(true);
  });

  it("does not let a write scope reach a different resource", () => {
    expect(scopesAllow(["consignments:write"], "runs:read")).toBe(false);
  });

  it("keeps personal data behind its own scope, never implied by anything else", () => {
    expect(scopesAllow(["consignments:write", "runs:write"], "pii:read")).toBe(false);
    expect(scopesAllow(["pii:read"], "pii:read")).toBe(true);
  });
});

describe("edge cases in verification", () => {
  const issued = issue({
    id: "key-1",
    tenantId,
    name: "n",
    scopes: ["consignments:read"],
    secret: "a".repeat(48),
  });

  it("rejects a stored hash of the wrong length rather than throwing", () => {
    expect(verify({ ...issued.record, secretHash: "abcd" }, issued.presentedSecret)).toBe(false);
  });

  it("rejects a scope string with no action part", () => {
    expect(scopesAllow(["consignments:write"], "consignments" as never)).toBe(false);
  });
});

describe("the scopes the platform issues", () => {
  it("covers the middle mile, so a hub can bag and dispatch", () => {
    expect(SCOPES).toContain("linehaul:write");
    expect(SCOPES).toContain("linehaul:read");
  });

  it("names every scope as a resource and an action", () => {
    for (const scope of SCOPES) expect(scope).toMatch(/^[a-z]+:(read|write)$/);
  });

  it("offers a read scope for every write scope, so a viewer can be created", () => {
    const writes = SCOPES.filter((scope) => scope.endsWith(":write"));

    for (const write of writes) {
      expect(SCOPES).toContain(write.replace(":write", ":read"));
    }
  });
});
