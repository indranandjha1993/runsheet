import { beforeEach, describe, expect, it } from "vitest";
import { currentSession, saveLocale, savedLocale, signIn, signOut } from "./session.js";

beforeEach(() => {
  localStorage.clear();
});

describe("signing in with a key", () => {
  it("keeps the key for the next request", () => {
    signIn("rsk_0123456789abcdef0123");

    expect(currentSession()?.key).toBe("rsk_0123456789abcdef0123");
  });

  it("trims what was pasted", () => {
    signIn("  rsk_0123456789abcdef0123\n");

    expect(currentSession()?.key).toBe("rsk_0123456789abcdef0123");
  });

  it("refuses something that is not a key, before any request is made", () => {
    expect(() => signIn("password123")).toThrow("that does not look like a Runsheet key");
    expect(currentSession()).toBeUndefined();
  });

  it("forgets the key on sign out", () => {
    signIn("rsk_0123456789abcdef0123");
    signOut();

    expect(currentSession()).toBeUndefined();
  });
});

describe("remembering the language", () => {
  it("remembers the choice across a reload", () => {
    saveLocale("ar");

    expect(savedLocale()).toBe("ar");
  });

  it("has nothing to remember at first", () => {
    expect(savedLocale()).toBeUndefined();
  });
});
