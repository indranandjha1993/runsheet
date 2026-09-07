import { useMemo, useState, type JSX } from "react";
import { complete, fail, nextStop, progress, renderStop, renderSummary, skip, type Runsheet } from "@runsheet/driver";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { Button, Field, Row } from "../components/primitives.js";
import { DriverStop } from "./DriverStop.js";
import { useShift, type Shift } from "./use-shift.js";

function StopArea({ sheet, shift }: { sheet: Runsheet; shift: Shift }): JSX.Element {
  const { t } = useLocale();
  const stop = nextStop(sheet);
  const view = useMemo(() => (stop === undefined ? undefined : renderStop(stop, t)), [stop, t]);
  if (stop === undefined || view === undefined) {
    return <p style={{ font: "var(--text-heading-m)" }}>{t("stops.none")}</p>;
  }
  return (
    <DriverStop
      stop={stop}
      view={view}
      actions={{
        deliver: () => { shift.tap("stop.completed", stop.id, {}); shift.update(complete(sheet, stop.id, { proofId: "captured-on-device" })); },
        fail: () => { shift.tap("stop.failed", stop.id, { reason: "customer_unavailable" }); shift.update(fail(sheet, stop.id, "customer_unavailable")); },
        skip: () => { shift.update(skip(sheet, stop.id, "later")); },
      }}
    />
  );
}

function ShiftFooter({ sheet, shift }: { sheet: Runsheet; shift: Shift }): JSX.Element {
  const { t } = useLocale();
  return (
    <footer style={{ display: "grid", gap: "var(--space-2)" }}>
      <Button onClick={() => { void shift.sync({ offline: t("app.offline"), synced: t("app.synced") }); }}>{t("app.sync")}</Button>
      {shift.note === undefined ? null : <p role="status" style={{ margin: 0, color: "var(--text-secondary)" }}>{shift.note}</p>}
      {progress(sheet).finished ? <p style={{ margin: 0 }}>{t("run.finish")}</p> : null}
    </footer>
  );
}

// The handset surface. Everything is bigger, one primary action sits where a thumb reaches,
// and nothing on this screen waits for the network: taps go to the queue and are sent later.
export function Driver({ openRun }: { openRun?: string | undefined }): JSX.Element {
  const { api } = useAccess();
  const { t, code, choose } = useLocale();
  const shift = useShift(api, openRun);
  const [runId, setRunId] = useState(openRun ?? "");

  const { sheet } = shift;
  const summary = sheet === undefined ? undefined : renderSummary(sheet, shift.queue?.pending.length ?? 0, t);

  return (
    <div data-surface="driver" style={{ maxWidth: "30em", width: "100%", margin: "0 auto", padding: "var(--space-4)", minHeight: "100vh", display: "flex", flexDirection: "column", gap: "var(--space-4)", font: "var(--text-body-l)", overflowX: "hidden" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ font: "var(--text-heading-m)" }}>{t("app.name")}</strong>
        <select aria-label={t("console.language")} value={code} onChange={(e) => { choose(e.target.value as typeof code); }} style={{ height: "var(--control-height)", font: "inherit" }}>
          <option value="en">English</option><option value="hi">हिन्दी</option><option value="ar">العربية</option>
        </select>
      </header>

      {sheet === undefined ? (
        <Row>
          <Field name="run" label={t("console.run")} value={runId} onChange={setRunId} />
          <Button primary onClick={() => { void shift.load(runId); }}>{t("run.start")}</Button>
        </Row>
      ) : null}

      {summary === undefined ? null : <p style={{ margin: 0, color: "var(--text-secondary)" }}>{summary.progress} · {summary.pending}</p>}

      {sheet === undefined ? null : <StopArea sheet={sheet} shift={shift} />}

      {sheet === undefined ? null : <ShiftFooter sheet={sheet} shift={shift} />}
    </div>
  );
}
