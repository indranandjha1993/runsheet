import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "./App.js";

const KEY = "rsk_0123456789abcdef0123456789abcdef";

function platform(routes: Record<string, unknown>): typeof globalThis.fetch {
  return vi.fn<typeof globalThis.fetch>((input) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const target = new URL(raw, "http://local");
    const path = target.pathname + target.search;
    const hit = Object.entries(routes).find(([known]) => path.startsWith(known));
    return Promise.resolve(
      new Response(JSON.stringify(hit === undefined ? { error: { code: "route_not_found", message: path } } : hit[1]), {
        status: hit === undefined ? 404 : 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

function show(path: string, routes: Record<string, unknown>): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App fetcher={platform(routes)} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("getting in", () => {
  it("asks for a key before showing anything", () => {
    show("/", {});

    expect(screen.getByText("Paste your key to sign in")).toBeInTheDocument();
  });

  it("refuses something that is not a key without calling the platform", async () => {
    const calls = platform({});
    render(<MemoryRouter><App fetcher={calls} /></MemoryRouter>);

    await userEvent.type(screen.getByLabelText("Paste your key to sign in"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByRole("alert")).toHaveTextContent("does not look like a Runsheet key");
    expect(calls).not.toHaveBeenCalled();
  });

  it("opens the board once a key is given", async () => {
    show("/", { "/v1/consignments": { consignments: [] } });

    await userEvent.type(screen.getByLabelText("Paste your key to sign in"), KEY);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Consignments" })).toBeInTheDocument();
  });
});

describe("the board", () => {
  beforeEach(() => {
    localStorage.setItem("runsheet.key", KEY);
  });

  it("shows the consignments still moving, with their status in one vocabulary", async () => {
    show("/", {
      "/v1/consignments": {
        consignments: [{ id: "01M1", status: "out_for_delivery", service: "express", originHubCode: "BLR1", destinationHubCode: "DEL3", orderId: "o1" }],
      },
    });

    expect(await screen.findByText("out_for_delivery")).toHaveAttribute("data-status", "active");
    expect(screen.getByText("BLR1 → DEL3")).toBeInTheDocument();
  });

  it("shows the platform's own error, with the trace, when a load fails", async () => {
    const failing = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: "forbidden", message: "this credential lacks the consignments:read scope" } }), { status: 403, headers: { "content-type": "application/json", traceparent: "00-aaaa-bbbb-01" } })),
    );
    render(<MemoryRouter><App fetcher={failing} /></MemoryRouter>);

    expect(await screen.findByRole("alert")).toHaveTextContent("consignments:read");
    expect(screen.getByRole("alert")).toHaveTextContent("00-aaaa-bbbb-01");
  });
});

describe("languages", () => {
  beforeEach(() => {
    localStorage.setItem("runsheet.key", KEY);
  });

  it("lays the whole page out right to left in Arabic and back again in English", async () => {
    show("/", { "/v1/consignments": { consignments: [] } });
    await screen.findByRole("heading", { name: "Consignments" });

    await userEvent.selectOptions(screen.getByLabelText("Language"), "ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(screen.getByRole("heading", { name: "الشحنات" })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("اللغة"), "en");
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
  });

  it("remembers the language for next time", async () => {
    show("/", { "/v1/consignments": { consignments: [] } });
    await screen.findByRole("heading", { name: "Consignments" });

    await userEvent.selectOptions(screen.getByLabelText("Language"), "hi");

    expect(localStorage.getItem("runsheet.locale")).toBe("hi");
  });
});

describe("the driver app", () => {
  beforeEach(() => {
    localStorage.setItem("runsheet.key", KEY);
  });

  const run = {
    id: "run-1",
    hubId: "DEL3",
    date: "2026-09-09",
    workerId: "drv-2",
    stops: [
      { id: "s1", sequence: 1, actions: [{ id: "a1", kind: "deliver", consignmentId: "c-1" }] },
      { id: "s2", sequence: 2, actions: [{ id: "a2", kind: "deliver", consignmentId: "c-2" }] },
    ],
  };

  it("loads a run and shows the next stop with a big primary action", async () => {
    show("/driver", { "/v1/runs/run-1": run });

    await userEvent.type(screen.getByLabelText("Run"), "run-1");
    await userEvent.click(screen.getByRole("button", { name: "Start the run" }));

    expect(await screen.findByRole("heading", { name: "c-1" })).toBeInTheDocument();
    expect(screen.getByText("2 stops left · Everything sent")).toBeInTheDocument();
  });

  it("moves to the next stop on a tap and keeps the tap waiting to send, without any network", async () => {
    show("/driver", { "/v1/runs/run-1": run });
    await userEvent.type(screen.getByLabelText("Run"), "run-1");
    await userEvent.click(screen.getByRole("button", { name: "Start the run" }));
    await screen.findByRole("heading", { name: "c-1" });

    await userEvent.click(screen.getByRole("button", { name: "Delivered" }));

    expect(screen.getByRole("heading", { name: "c-2" })).toBeInTheDocument();
    expect(screen.getByText("1 stops left · 1 waiting to send")).toBeInTheDocument();
  });

  it("sends the queue and reports that everything went", async () => {
    show("/driver", {
      "/v1/runs/run-1": run,
      "/v1/sync/batches": { results: [{ command_id: "any", status: "accepted" }], uploads: [] },
    });
    await userEvent.type(screen.getByLabelText("Run"), "run-1");
    await userEvent.click(screen.getByRole("button", { name: "Start the run" }));
    await screen.findByRole("heading", { name: "c-1" });
    await userEvent.click(screen.getByRole("button", { name: "Delivered" }));

    await userEvent.click(screen.getByRole("button", { name: "Send now" }));

    await waitFor(() => { expect(screen.getByRole("status")).toHaveTextContent("Everything sent"); });
  });
});

describe("opening from a link", () => {
  it("signs in and opens in the language the link named, and clears the fragment", async () => {
    window.history.replaceState(null, "", "/#key=rsk_0123456789abcdef0123456789abcdef&locale=hi");
    render(<MemoryRouter><App fetcher={platform({ "/v1/consignments": { consignments: [] } })} /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "खेप" })).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(localStorage.getItem("runsheet.key")).toBe("rsk_0123456789abcdef0123456789abcdef");
  });
});

describe("a screen that breaks", () => {
  beforeEach(() => {
    localStorage.setItem("runsheet.key", KEY);
  });

  it("shows what went wrong instead of a blank page, and the rest keeps working", async () => {
    // The exceptions queue answers with a shape the screen cannot read.
    show("/exceptions", { "/v1/exceptions": { exceptions: [{ id: "e1", type: "cash_variance", severity: "high", subjectId: "run-1", state: "raised" }] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Exceptions:");
    expect(screen.getByRole("link", { name: "Board" })).toBeInTheDocument();
  });
});
