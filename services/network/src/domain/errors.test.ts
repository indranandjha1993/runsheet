import { describe, expect, it } from "vitest";
import { DomainError, isDomainError } from "./errors.js";

describe("domain errors", () => {
  it("carries a code the transport can map to a status", () => {
    expect(new DomainError("already_exists", "a hub with that code exists").status).toBe(409);
    expect(new DomainError("not_found", "no such hub").status).toBe(404);
    expect(new DomainError("invalid_input", "bad country").status).toBe(400);
    expect(new DomainError("tenant_required", "no tenant").status).toBe(400);
  });

  it("is recognisable without checking a string", () => {
    expect(isDomainError(new DomainError("not_found", "gone"))).toBe(true);
    expect(isDomainError(new Error("gone"))).toBe(false);
    expect(isDomainError("gone")).toBe(false);
  });

  it("keeps the message readable for whoever sees it", () => {
    expect(new DomainError("already_exists", "a hub with code BLR-01 already exists").message).toBe(
      "a hub with code BLR-01 already exists",
    );
  });
});
