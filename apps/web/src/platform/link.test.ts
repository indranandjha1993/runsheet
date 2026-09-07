import { describe, expect, it } from "vitest";
import { consumeLink, readLink } from "./link.js";

describe("what a link can carry", () => {
  it("reads a key, a language, and a run from the fragment", () => {
    expect(readLink("#key=rsk_abc&locale=ar&run=run-1")).toEqual({ key: "rsk_abc", locale: "ar", run: "run-1" });
  });

  it("reads nothing from a plain address", () => {
    expect(readLink("")).toEqual({});
  });

  it("clears the fragment once it has been read, so the key is not left in the address bar", () => {
    window.history.replaceState(null, "", "/driver#key=rsk_abc&run=run-1");

    const hints = consumeLink();

    expect(hints).toEqual({ key: "rsk_abc", run: "run-1" });
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/driver");
  });
});
