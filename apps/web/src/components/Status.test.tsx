import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Status, statusOf } from "./Status.js";

describe("a status on screen", () => {
  it("shows the label and a mark, never colour alone", () => {
    render(<Status kind="breached" label="Breached" />);

    const shown = screen.getByText("Breached");
    expect(shown).toBeInTheDocument();
    expect(shown.textContent).toContain("▲");
  });

  it("names the status in the markup so a test or a style can find it", () => {
    render(<Status kind="done" label="Delivered" />);

    expect(screen.getByText("Delivered")).toHaveAttribute("data-status", "done");
  });
});

describe("mapping a domain state onto the five statuses", () => {
  it("reads every service's states in one vocabulary", () => {
    expect(statusOf("out_for_delivery")).toBe("active");
    expect(statusOf("attempted")).toBe("at_risk");
    expect(statusOf("lost")).toBe("breached");
    expect(statusOf("delivered")).toBe("done");
    expect(statusOf("sealed")).toBe("active");
    expect(statusOf("mismatched")).toBe("at_risk");
  });

  it("treats a state it has never seen as pending rather than crashing", () => {
    expect(statusOf("teleported")).toBe("pending");
  });
});
