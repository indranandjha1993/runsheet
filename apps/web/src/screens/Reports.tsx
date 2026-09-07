import { useState, type JSX } from "react";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { useLoad } from "../platform/use-load.js";
import { Await, Button, Field, Panel, Row, Table } from "../components/primitives.js";

interface Report { name: string; description: string; columns: string[] }
interface Ran { columns: string[]; rows: Record<string, string | number | null>[] }

function monthStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export function Reports(): JSX.Element {
  const { api } = useAccess();
  const { t } = useLocale();
  const catalogue = useLoad(() => api.get<{ reports: Report[] }>("/v1/reports"), []);
  const [name, setName] = useState("delivery_performance");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [asked, setAsked] = useState<string | undefined>();
  const ran = useLoad(() => (asked === undefined ? Promise.resolve({ ok: true as const, value: undefined }) : api.get<Ran>(asked)), [asked]);

  const query = `/v1/reports/${name}?from=${from}&to=${to}`;

  const download = async (): Promise<void> => {
    const file = await api.file(`${query}&format=csv`);
    if (!file.ok) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([file.value.text], { type: "text/csv" }));
    link.download = file.value.filename;
    link.click();
  };

  return (
    <Panel title={t("console.reports")}>
      <Await loaded={catalogue.loaded}>
        {({ reports }) => (
          <Row>
            <label style={{ display: "grid", gap: "var(--space-1)", font: "var(--text-caption)", color: "var(--text-secondary)" }}>
              {t("console.type")}
              <select value={name} onChange={(e) => { setName(e.target.value); }} style={{ height: "var(--control-height)", font: "var(--text-body)" }}>
                {reports.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
              </select>
            </label>
            <Field name="from" label={t("console.from")} value={from} onChange={setFrom} type="date" />
            <Field name="to" label={t("console.to")} value={to} onChange={setTo} type="date" />
            <Button primary onClick={() => { setAsked(query); }}>{t("console.run")}</Button>
            <Button onClick={() => { void download(); }}>{t("console.download")}</Button>
          </Row>
        )}
      </Await>
      <Await loaded={ran.loaded}>
        {(result) =>
          result === undefined ? null : (
            <Table<Record<string, string | number | null>>
              keyOf={(row) => JSON.stringify(row)}
              rows={result.rows}
              columns={result.columns.map((column) => ({ key: column, label: column, numeric: column !== "day" && column !== "hub_id", render: (row) => String(row[column] ?? "") }))}
            />
          )
        }
      </Await>
    </Panel>
  );
}
