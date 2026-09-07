import type { JSX } from "react";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { useLoad } from "../platform/use-load.js";
import { Await, Button, Id, Panel, Table } from "../components/primitives.js";
import { Status, statusOf } from "../components/Status.js";

interface Policy { id: string; name: string; version: number; state: string; autonomy: string; triggerEvent: string; rolloutPercent?: number }

export function Policies(): JSX.Element {
  const { api } = useAccess();
  const { t } = useLocale();
  const policies = useLoad(() => api.get<{ policies: Policy[] }>("/v1/policies"), []);

  return (
    <Panel title={t("console.policies")} actions={<Button onClick={policies.reload}>{t("console.refresh")}</Button>}>
      <Await loaded={policies.loaded}>
        {({ policies: rows }) => (
          <Table<Policy>
            keyOf={(p) => p.id}
            rows={rows}
            columns={[
              { key: "name", label: t("console.reference"), render: (p) => `${p.name} v${String(p.version)}` },
              { key: "state", label: t("console.state"), render: (p) => <Status kind={statusOf(p.state)} label={p.state} /> },
              { key: "autonomy", label: t("console.type"), render: (p) => p.autonomy },
              { key: "trigger", label: t("console.trigger"), render: (p) => <Id value={p.triggerEvent} /> },
              { key: "rollout", label: "%", numeric: true, render: (p) => (p.rolloutPercent === undefined ? "" : String(p.rolloutPercent)) },
            ]}
          />
        )}
      </Await>
    </Panel>
  );
}
