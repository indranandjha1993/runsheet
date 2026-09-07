import type { JSX } from "react";
import { isolate, type Stop, type StopView } from "@runsheet/driver";
import { useLocale } from "../platform/locale-context.js";

export interface StopActions {
  readonly deliver: () => void;
  readonly fail: () => void;
  readonly skip: () => void;
}

const secondary = {
  height: "var(--control-height)",
  font: "inherit",
  background: "var(--surface)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius)",
} as const;

// One stop, one primary action where a thumb reaches, two smaller ones beneath it. The barcode
// is isolated so it reads correctly inside Arabic.
export function DriverStop({ stop, view, actions }: { stop: Stop; view: StopView; actions: StopActions }): JSX.Element {
  const { t } = useLocale();
  return (
    <section data-stop={stop.id} style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)", padding: "var(--space-4)", display: "grid", gap: "var(--space-3)", flex: 1 }}>
      <p style={{ margin: 0, font: "var(--text-caption)", color: "var(--text-secondary)" }}>{t("stops.next")}</p>
      <h1 style={{ margin: 0, font: "var(--text-heading-l)" }}><bdi>{view.title}</bdi></h1>
      {view.address.map((line) => <p key={line} style={{ margin: 0 }}>{line}</p>)}
      {view.barcode === isolate("") ? null : <p style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>{view.barcode}</p>}
      {view.cash === undefined ? null : <p style={{ margin: 0, font: "var(--text-numeric)" }}>{view.cash}</p>}
      {view.proof === undefined ? null : <p style={{ margin: 0, color: "var(--status-at-risk-ink)" }}>{view.proof}</p>}
      <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "auto" }}>
        <button type="button" onClick={actions.deliver} style={{ height: "var(--control-height-primary)", font: "var(--text-body-l)", fontWeight: 600, background: "var(--action-primary)", color: "var(--surface)", border: 0, borderRadius: "var(--radius)" }}>
          {t("action.deliver")}
        </button>
        <button type="button" onClick={actions.fail} style={secondary}>{t("action.fail")}</button>
        <button type="button" onClick={actions.skip} style={secondary}>{t("action.skip")}</button>
      </div>
    </section>
  );
}
