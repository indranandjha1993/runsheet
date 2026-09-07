import { useState, type JSX } from "react";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { useLoad } from "../platform/use-load.js";
import { Await, Button, Id, Panel, Row, Table } from "../components/primitives.js";
import { Status, statusOf } from "../components/Status.js";

interface Settlement { id: string; lineId: string; invoiceId: string; state: string; varianceMinor: number; reasons: string[] }

const STATES = ["mismatched", "missing_evidence", "disputed", "matched", "approved", "paid", "written_off"];

export function Settlements(): JSX.Element {
  const { api } = useAccess();
  const { t } = useLocale();
  const [state, setState] = useState("mismatched");
  const queue = useLoad(() => api.get<{ settlements: Settlement[] }>(`/v1/settlements?state=${state}`), [state]);

  const act = async (id: string, type: string): Promise<void> => {
    await api.post(`/v1/settlements/${id}/events`, type === "disputed" ? { type, by: "console", note: "raised from the console" } : { type, by: "console" });
    queue.reload();
  };

  return (
    <Panel title={t("console.settlements")} actions={<Button onClick={queue.reload}>{t("console.refresh")}</Button>}>
      <Row>
        {STATES.map((s) => (
          <Button key={s} primary={s === state} onClick={() => { setState(s); }}>{s}</Button>
        ))}
      </Row>
      <Await loaded={queue.loaded}>
        {({ settlements }) => (
          <Table<Settlement>
            keyOf={(s) => s.id}
            rows={settlements}
            columns={[
              { key: "id", label: t("console.reference"), render: (s) => <Id value={s.id} /> },
              { key: "state", label: t("console.state"), render: (s) => <Status kind={statusOf(s.state)} label={s.state} /> },
              { key: "variance", label: t("console.variance"), numeric: true, render: (s) => String(s.varianceMinor) },
              { key: "reasons", label: t("console.type"), render: (s) => s.reasons.join(", ") },
              { key: "act", label: "", render: (s) => (
                <span style={{ display: "inline-flex", gap: "var(--space-2)" }}>
                  <Button onClick={() => { void act(s.id, "approved"); }}>{t("console.approve")}</Button>
                  <Button onClick={() => { void act(s.id, "disputed"); }}>{t("console.dispute")}</Button>
                </span>
              ) },
            ]}
          />
        )}
      </Await>
    </Panel>
  );
}
