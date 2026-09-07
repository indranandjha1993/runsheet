import { useState, type JSX } from "react";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { useLoad } from "../platform/use-load.js";
import { Await, Button, Field, Money, Panel, Row, Table } from "../components/primitives.js";

interface Statement { currency: string; float_minor: number; entries: { kind: string; reference: string; delta_minor: number; occurred_at: string }[] }
interface Closed { variance_minor: number; float_after_minor: number }

export function Cash(): JSX.Element {
  const { api } = useAccess();
  const { t } = useLocale();
  const [driver, setDriver] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [asked, setAsked] = useState<{ driver: string; currency: string } | undefined>();
  const [run, setRun] = useState("");
  const [counted, setCounted] = useState("");
  const [closed, setClosed] = useState<Closed | string | undefined>();

  const statement = useLoad(() => (asked === undefined ? Promise.resolve({ ok: true as const, value: undefined }) : api.get<Statement>(`/v1/cash/drivers/${encodeURIComponent(asked.driver)}/statement?currency=${asked.currency}`)), [asked]);

  const closeRun = async (): Promise<void> => {
    const result = await api.post<Closed>(`/v1/cash/runs/${encodeURIComponent(run)}/close`, { driver_id: driver, currency, counted_minor: Number(counted) });
    setClosed(result.ok ? result.value : result.error.message);
    statement.reload();
  };

  return (
    <Panel title={t("console.cash")}>
      <Row>
        <Field name="driver" label={t("console.driver_id")} value={driver} onChange={setDriver} />
        <Field name="currency" label="INR" value={currency} onChange={setCurrency} />
        <Button primary onClick={() => { setAsked({ driver, currency }); }}>{t("console.search")}</Button>
      </Row>
      <Await loaded={statement.loaded}>
        {(found) =>
          found === undefined ? null : (
            <>
              <p style={{ font: "var(--text-numeric)", margin: "0 var(--space-3)" }}><Money minor={found.float_minor} currency={found.currency} /></p>
              <Table
                keyOf={(e) => `${e.kind}-${e.reference}-${e.occurred_at}`}
                rows={found.entries}
                columns={[
                  { key: "kind", label: t("console.type"), render: (e) => e.kind },
                  { key: "ref", label: t("console.reference"), render: (e) => e.reference },
                  { key: "delta", label: t("console.amount"), numeric: true, render: (e) => <Money minor={e.delta_minor} currency={found.currency} /> },
                ]}
              />
            </>
          )
        }
      </Await>
      <Row>
        <Field name="run" label={t("console.run")} value={run} onChange={setRun} />
        <Field name="counted" label={t("console.counted")} value={counted} onChange={setCounted} type="number" />
        <Button onClick={() => { void closeRun(); }}>{t("console.close_run")}</Button>
        {closed === undefined ? null : typeof closed === "string" ? <span role="alert">{closed}</span> : <span>{t("console.variance")}: <Money minor={closed.variance_minor} currency={currency} /></span>}
      </Row>
    </Panel>
  );
}
