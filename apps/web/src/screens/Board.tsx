import { useState, type JSX } from "react";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { useLoad } from "../platform/use-load.js";
import { Await, Button, Field, Id, Panel, Row, Table } from "../components/primitives.js";
import { Status, statusOf } from "../components/Status.js";

interface Run { id: string; hubId: string; date: string; status: string; workerId?: string; stops: { id: string }[] }
interface Consignment { id: string; status: string; service: string; originHubCode: string; destinationHubCode: string; orderId: string }

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Board(): JSX.Element {
  const { api } = useAccess();
  const { t } = useLocale();
  const [hub, setHub] = useState("");
  const [date, setDate] = useState(today());
  const [asked, setAsked] = useState<{ hub: string; date: string } | undefined>();

  const runs = useLoad(
    () => (asked === undefined ? Promise.resolve({ ok: true as const, value: { runs: [] as Run[] } }) : api.get<{ runs: Run[] }>(`/v1/runs?hub_id=${encodeURIComponent(asked.hub)}&date=${asked.date}`)),
    [asked],
  );
  const consignments = useLoad(() => api.get<{ consignments: Consignment[] }>("/v1/consignments?limit=200"), []);

  return (
    <>
      <Panel title={t("console.board")} actions={<Button onClick={() => { runs.reload(); consignments.reload(); }}>{t("console.refresh")}</Button>}>
        <Row>
          <Field name="hub" label={t("console.hub_id")} value={hub} onChange={setHub} placeholder="BLR1" />
          <Field name="date" label={t("console.date")} value={date} onChange={setDate} type="date" />
          <Button primary onClick={() => { setAsked({ hub, date }); }}>{t("console.search")}</Button>
        </Row>
        <Await loaded={runs.loaded}>
          {({ runs: rows }) => (
            <Table<Run>
              keyOf={(run) => run.id}
              rows={rows}
              columns={[
                { key: "id", label: t("console.run"), render: (run) => <Id value={run.id} /> },
                { key: "status", label: t("console.status"), render: (run) => <Status kind={statusOf(run.status)} label={run.status} /> },
                { key: "driver", label: t("console.driver_id"), render: (run) => run.workerId ?? "" },
                { key: "stops", label: t("console.stops"), numeric: true, render: (run) => String(run.stops.length) },
              ]}
            />
          )}
        </Await>
      </Panel>
      <Panel title={t("console.consignments")}>
        <Await loaded={consignments.loaded}>
          {({ consignments: rows }) => (
            <Table<Consignment>
              keyOf={(c) => c.id}
              rows={rows}
              columns={[
                { key: "id", label: t("console.reference"), render: (c) => <Id value={c.id} /> },
                { key: "status", label: t("console.status"), render: (c) => <Status kind={statusOf(c.status)} label={c.status} /> },
                { key: "lane", label: t("console.lane"), render: (c) => `${c.originHubCode} → ${c.destinationHubCode}` },
                { key: "service", label: t("console.service"), render: (c) => c.service },
              ]}
            />
          )}
        </Await>
      </Panel>
    </>
  );
}
