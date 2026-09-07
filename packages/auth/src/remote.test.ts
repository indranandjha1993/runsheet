import { describe, expect, it, vi } from "vitest";
import { remoteLookup } from "./remote.js";

const caller = { tenantId: "t-1", keyId: "k-1", fingerprint: "abc", scopes: ["runs:read"] };

function respondingWith(status: number, body: unknown): typeof globalThis.fetch {
  const response = new Response(JSON.stringify(body), { status });
  return vi.fn(() => Promise.resolve(response.clone()));
}

describe("asking the identity service who is calling", () => {
  it("returns the caller it is told about", async () => {
    const lookup = remoteLookup({
      identityUrl: "http://identity",
      fetch: respondingWith(200, caller),
    });

    expect(await lookup("rsk_good")).toEqual(caller);
  });

  it("returns nothing when the credential is refused", async () => {
    const lookup = remoteLookup({ identityUrl: "http://identity", fetch: respondingWith(401, {}) });

    expect(await lookup("rsk_bad")).toBeUndefined();
  });

  it("asks once and reuses the answer inside the cache window", async () => {
    const call = respondingWith(200, caller);
    const lookup = remoteLookup({ identityUrl: "http://identity", fetch: call, now: () => 1000 });

    await lookup("rsk_good");
    await lookup("rsk_good");

    expect(call).toHaveBeenCalledTimes(1);
  });

  it("asks again once the cached answer has expired", async () => {
    const call = respondingWith(200, caller);
    let clock = 1000;
    const lookup = remoteLookup({
      identityUrl: "http://identity",
      fetch: call,
      cacheMs: 100,
      now: () => clock,
    });

    await lookup("rsk_good");
    clock += 200;
    await lookup("rsk_good");

    expect(call).toHaveBeenCalledTimes(2);
  });

  it("caches a refusal too, so a bad key cannot be used to hammer identity", async () => {
    const call = respondingWith(401, {});
    const lookup = remoteLookup({ identityUrl: "http://identity", fetch: call, now: () => 1000 });

    await lookup("rsk_bad");
    await lookup("rsk_bad");

    expect(call).toHaveBeenCalledTimes(1);
  });

  it("keeps one credential's answer separate from another's", async () => {
    const call = respondingWith(200, caller);
    const lookup = remoteLookup({ identityUrl: "http://identity", fetch: call, now: () => 1000 });

    await lookup("rsk_a");
    await lookup("rsk_b");

    expect(call).toHaveBeenCalledTimes(2);
  });
});
