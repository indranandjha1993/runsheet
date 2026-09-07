import type { JSX } from "react";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { useLoad } from "../platform/use-load.js";
import { Await, Button, Id, Panel, Table } from "../components/primitives.js";
import { Status } from "../components/Status.js";

interface Exception { id: string; type: string; severity: string; subjectId: string; state: string; clock: { startedAt: string } }

const SEVERITY: Record<string, "at_risk" | "breached" | "pending"> = { high: "breached", medium: "at_risk", low: "pending" };

export function Exceptions(): JSX.Element {
  const { api } = useAccess();
  const { t } = useLocale();
  const queue = useLoad(() => api.get<{ exceptions: Exception[] }>("/v1/exceptions"), []);

  const work = async (id: string, type: string): Promise<void> => {
    await api.post(`/v1/exceptions/${id}/events`, { type, by: "console" });
    queue.reload();
  };

  return (
    <Panel title={t("console.exceptions")} actions={<Button onClick={queue.reload}>{t("console.refresh")}</Button>}>
      <Await loaded={queue.loaded}>
        {({ exceptions }) => (
          <Table<Exception>
            keyOf={(e) => e.id}
            rows={exceptions}
            columns={[
              { key: "severity", label: t("console.severity"), render: (e) => <Status kind={SEVERITY[e.severity] ?? "pending"} label={e.severity} /> },
              { key: "type", label: t("console.type"), render: (e) => e.type },
              { key: "subject", label: t("console.reference"), render: (e) => <Id value={e.subjectId} /> },
              { key: "state", label: t("console.state"), render: (e) => e.state },
              { key: "opened", label: t("console.opened"), render: (e) => new Date(e.clock.startedAt).toLocaleString() },
              { key: "act", label: "", render: (e) => <Button onClick={() => { void work(e.id, "triaged"); }}>{t("console.triage")}</Button> },
            ]}
          />
        )}
      </Await>
    </Panel>
  );
}
