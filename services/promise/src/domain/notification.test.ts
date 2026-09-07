import { describe, expect, it } from "vitest";
import { compose, LOCALES, TEMPLATES } from "./notification.js";

describe("composing a message", () => {
  it("fills a template in the customer's language", () => {
    const message = compose({
      template: "running_late",
      locale: "en-IN",
      values: { window: "4pm to 6pm", eta: "7pm" },
    });

    expect(message).toContain("7pm");
    expect(message).not.toContain("{");
  });

  it("speaks Hindi and Arabic, because our customers do", () => {
    expect(compose({ template: "out_for_delivery", locale: "hi-IN", values: {} })).not.toBe("");
    expect(compose({ template: "out_for_delivery", locale: "ar-AE", values: {} })).not.toBe("");
  });

  it("falls back to English rather than sending nothing", () => {
    const message = compose({ template: "out_for_delivery", locale: "fr-FR", values: {} });

    expect(message).toBe(compose({ template: "out_for_delivery", locale: "en-IN", values: {} }));
  });

  it("refuses a template nobody wrote", () => {
    expect(() => compose({ template: "haiku", locale: "en-IN", values: {} })).toThrow(
      "unknown message template: haiku",
    );
  });

  it("refuses to send a message with a hole in it", () => {
    expect(() => compose({ template: "running_late", locale: "en-IN", values: {} })).toThrow(
      "the running_late message is missing values: window, eta",
    );
  });

  it("has every template in every language, so nobody gets a worse experience", () => {
    for (const template of Object.keys(TEMPLATES)) {
      for (const locale of LOCALES) {
        expect(
          compose({ template, locale, values: { window: "w", eta: "e", reason: "r" } }),
        ).not.toBe("");
      }
    }
  });
});
