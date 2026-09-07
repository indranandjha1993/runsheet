import { useState, type JSX } from "react";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { useLoad } from "../platform/use-load.js";
import { Await, Button, Field, Panel, Row, Table } from "../components/primitives.js";
import { Status, statusOf } from "../components/Status.js";

interface Detail { id: string; status: string; service: string; originHubCode: string; destinationHubCode: string; paymentMode: string; deliveredAt?: string; packages: { weightGrams: number }[] }
interface Scan { hub_id: string; scanned_at: string; accepted: boolean; exception?: string; weight_grams?: number }

export function ConsignmentScreen(): JSX.Element {
  const { api } = useAccess();
  const { t } = useLocale();
  const [typed, setTyped] = useState("");
  const [id, setId] = useState<string | undefined>();

  const detail = useLoad(() => (id === undefined ? Promise.resolve({ ok: true as const, value: undefined }) : api.get<Detail>(`/v1/consignments/${id}`)), [id]);
  const scans = useLoad(() => (id === undefined ? Promise.resolve({ ok: true as const, value: { scans: [] as Scan[] } }) : api.get<{ scans: Scan[] }>(`/v1/hub-scans?consignment_id=${id}`)), [id]);

  return (
    <Panel title={t("console.consignments")}>
      <Row>
        <Field name="consignment" label={t("console.reference")} value={typed} onChange={setTyped} placeholder="01M…" />
        <Button primary onClick={() => { setId(typed.trim()); }}>{t("console.search")}</Button>
      </Row>
      <Await loaded={detail.loaded}>
        {(found) =>
          found === undefined ? null : (
            <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "var(--space-1) var(--space-4)", padding: "var(--space-3)", margin: 0 }}>
              <dt>{t("console.status")}</dt><dd style={{ margin: 0 }}><Status kind={statusOf(found.status)} label={found.status} /></dd>
              <dt>{t("console.lane")}</dt><dd style={{ margin: 0 }}>{found.originHubCode} → {found.destinationHubCode}</dd>
              <dt>{t("console.service")}</dt><dd style={{ margin: 0 }}>{found.service} · {found.paymentMode}</dd>
              <dt>{t("console.weight")}</dt><dd style={{ margin: 0 }}>{found.packages.reduce((sum, p) => sum + p.weightGrams, 0)}</dd>
              {found.deliveredAt === undefined ? null : <><dt>{t("action.deliver")}</dt><dd style={{ margin: 0 }}>{new Date(found.deliveredAt).toLocaleString()}</dd></>}
            </dl>
          )
        }
      </Await>
      <Await loaded={scans.loaded}>
        {({ scans: rows }) => (
          <Table<Scan>
            keyOf={(s) => `${s.hub_id}-${s.scanned_at}`}
            rows={rows}
            columns={[
              { key: "hub", label: t("console.hub_id"), render: (s) => s.hub_id },
              { key: "at", label: t("console.scanned"), render: (s) => new Date(s.scanned_at).toLocaleString() },
              { key: "accepted", label: t("console.status"), render: (s) => <Status kind={s.accepted ? (s.exception === undefined ? "done" : "at_risk") : "breached"} label={s.exception ?? (s.accepted ? "ok" : "refused")} /> },
              { key: "weight", label: t("console.weight"), numeric: true, render: (s) => (s.weight_grams === undefined ? "" : String(s.weight_grams)) },
            ]}
          />
        )}
      </Await>
    </Panel>
  );
}
