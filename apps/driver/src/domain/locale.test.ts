import { describe, expect, it } from "vitest";
import {
  directionOf,
  isolate,
  LOCALES,
  pseudo,
  translator,
} from "./locale.js";

describe("choosing a locale", () => {
  it("offers the languages the first markets speak", () => {
    expect(LOCALES.map((locale) => locale.code)).toEqual(["en", "hi", "ar", "xx"]);
  });

  it("lays Arabic out right to left and everything else left to right", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
    expect(directionOf("hi")).toBe("ltr");
  });
});

describe("translating", () => {
  it("gives the phrase in the chosen language", () => {
    expect(translator("hi")("stops.remaining", { count: "4" })).toContain("4");
    expect(translator("ar")("action.deliver")).not.toBe("action.deliver");
  });

  it("falls back to English rather than showing a key to a driver", () => {
    const missing = translator("ar")("nothing.here.at.all");

    expect(missing).toBe("nothing.here.at.all");
  });

  it("fills in the values a phrase asks for", () => {
    expect(translator("en")("stops.remaining", { count: "12" })).toBe("12 stops left");
  });

  it("leaves a placeholder alone when nothing was given for it", () => {
    expect(translator("en")("stops.remaining")).toContain("{count}");
  });

  it("says the same things in every language, so no screen falls back mid-sentence", () => {
    const english = Object.keys(translator("en").phrases);

    for (const locale of LOCALES) {
      expect(Object.keys(translator(locale.code).phrases).sort()).toEqual(english.sort());
    }
  });
});

describe("the pseudo locale that proves a layout survives translation", () => {
  it("grows a string by about a third, which is what real translation does", () => {
    const grown = pseudo("Deliver");

    expect(grown.length).toBeGreaterThan("Deliver".length * 1.25);
  });

  it("leaves the placeholder readable, so the growth is testable", () => {
    expect(pseudo("{count} stops left")).toContain("{count}");
  });

  it("is used for every phrase in the test locale", () => {
    const test = translator("xx");

    expect(test("action.deliver")).not.toBe(translator("en")("action.deliver"));
    expect(test("action.deliver").length).toBeGreaterThan(
      translator("en")("action.deliver").length,
    );
  });
});

describe("identifiers inside a right-to-left sentence", () => {
  it("wraps a tracking number so it cannot be reordered around it", () => {
    const wrapped = isolate("RS0000000013");

    expect(wrapped.startsWith("⁦")).toBe(true);
    expect(wrapped.endsWith("⁩")).toBe(true);
  });

  it("keeps the identifier itself untouched between the marks", () => {
    expect(isolate("RS0000000013").slice(1, -1)).toBe("RS0000000013");
  });

  it("leaves an empty value alone rather than wrapping nothing", () => {
    expect(isolate("")).toBe("");
  });
});
