import { describe, expect, it } from "vitest";
import {
  callerFrom,
  NotAuthenticated,
  NotPermitted,
  requireScope,
  type CallerLookup,
} from "./caller.js";

const known: CallerLookup = (presented) =>
  Promise.resolve(
    presented === "rsk_good"
      ? { tenantId: "t-1", keyId: "k-1", fingerprint: "abc123def456", scopes: ["runs:write"] }
      : undefined,
  );

describe("identifying the caller", () => {
  it("reads the credential from the authorization header", async () => {
    const caller = await callerFrom(known, { authorization: "Bearer rsk_good" });

    expect(caller.tenantId).toBe("t-1");
  });

  it("accepts the header however it is capitalised", async () => {
    const caller = await callerFrom(known, { Authorization: "bearer rsk_good" });

    expect(caller.tenantId).toBe("t-1");
  });

  it("refuses a credential the service does not recognise", async () => {
    await expect(callerFrom(known, { authorization: "Bearer rsk_bad" })).rejects.toThrow(
      "the credential presented is not usable",
    );
  });

  it("refuses a request with no credential at all", async () => {
    await expect(callerFrom(known, {})).rejects.toThrow(/not usable/);
  });

  it("refuses a header that is not a bearer credential", async () => {
    await expect(callerFrom(known, { authorization: "Basic abc" })).rejects.toThrow(/not usable/);
  });

  it("refuses an authorization header with no credential after the scheme", async () => {
    await expect(callerFrom(known, { authorization: "Bearer" })).rejects.toThrow(/not usable/);
  });

  it("ignores headers it does not care about", async () => {
    const caller = await callerFrom(known, {
      "content-type": "application/json",
      authorization: "Bearer rsk_good",
    });

    expect(caller.keyId).toBe("k-1");
  });

  it("ignores a tenant header, so nobody can claim a tenant by asking", async () => {
    const caller = await callerFrom(known, {
      authorization: "Bearer rsk_good",
      "x-tenant-id": "someone-elses-tenant",
    });

    expect(caller.tenantId).toBe("t-1");
  });

  it("carries the scopes the credential holds", async () => {
    const caller = await callerFrom(known, { authorization: "Bearer rsk_good" });

    expect(caller.scopes).toEqual(["runs:write"]);
  });
});

describe("what a caller may do", () => {
  const caller = {
    tenantId: "t-1",
    keyId: "k-1",
    fingerprint: "abc123def456",
    scopes: ["runs:write", "consignments:read"],
  };

  it("permits a scope held outright", () => {
    expect(() => {
      requireScope(caller, "consignments:read");
    }).not.toThrow();
  });

  it("permits reading where the caller may write", () => {
    expect(() => {
      requireScope(caller, "runs:read");
    }).not.toThrow();
  });

  it("refuses writing where the caller may only read", () => {
    expect(() => {
      requireScope(caller, "consignments:write");
    }).toThrow("this credential lacks the consignments:write scope");
  });

  it("refuses a scope for a resource the caller has nothing on", () => {
    expect(() => {
      requireScope(caller, "network:read");
    }).toThrow(/network:read/);
  });

  it("never implies personal data from any other scope", () => {
    expect(() => {
      requireScope(caller, "pii:read");
    }).toThrow(/pii:read/);
  });

  it("reports the right status for each refusal, so transports need no mapping table", () => {
    expect(new NotAuthenticated().status).toBe(401);
    expect(new NotPermitted("runs:read").status).toBe(403);
  });
});

describe("a service reading on behalf of a tenant", () => {
  const service = {
    tenantId: "platform",
    keyId: "svc",
    fingerprint: "f",
    scopes: ["consignments:read_any"],
  };
  const lookup = (presented: string) =>
    Promise.resolve(presented === "rsk_svc" ? service : undefined);

  it("takes the tenant from the header when the key may read any tenant", async () => {
    const caller = await callerFrom(lookup, {
      authorization: "Bearer rsk_svc",
      "x-on-behalf-of-tenant": "tenant-42",
    });

    expect(caller.tenantId).toBe("tenant-42");
  });

  it("keeps its own tenant when no header names one", async () => {
    const caller = await callerFrom(lookup, { authorization: "Bearer rsk_svc" });

    expect(caller.tenantId).toBe("platform");
  });

  it("ignores the header for a key that may not read any tenant", async () => {
    const ordinary = (presented: string) =>
      Promise.resolve(
        presented === "rsk_t"
          ? { ...service, tenantId: "tenant-1", scopes: ["consignments:read"] }
          : undefined,
      );

    const caller = await callerFrom(ordinary, {
      authorization: "Bearer rsk_t",
      "x-on-behalf-of-tenant": "tenant-42",
    });

    expect(caller.tenantId).toBe("tenant-1");
  });

  it("refuses a blank tenant in the header rather than reading nobody's data", async () => {
    await expect(
      callerFrom(lookup, { authorization: "Bearer rsk_svc", "x-on-behalf-of-tenant": "  " }),
    ).rejects.toThrow("names no tenant");
  });

  it("satisfies a read scope with the read-any scope", () => {
    expect(() => {
      requireScope(service, "consignments:read");
    }).not.toThrow();
  });

  it("does not let read-any stand in for write, or for another resource", () => {
    expect(() => {
      requireScope(service, "consignments:write");
    }).toThrow();
    expect(() => {
      requireScope(service, "runs:read");
    }).toThrow();
  });
});
