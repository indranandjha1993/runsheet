import { useState, type JSX } from "react";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { useLoad } from "../platform/use-load.js";
import { Await, Button, Field, Id, Panel, Row, Table } from "../components/primitives.js";
import { Status, statusOf } from "../components/Status.js";

interface Bag { id: string; status: string; consignment_ids: string[]; seal_number: string | null }
interface Trip { id: string; status: string; originHubId: string; destinationHubId: string; departsOn: string; bagIds: string[]; driverId?: string }

export function Linehaul(): JSX.Element {
  const { api } = useAccess();
  const { t } = useLocale();
  const [hub, setHub] = useState("");
  const [asked, setAsked] = useState<string | undefined>();
  const bags = useLoad(() => (asked === undefined ? Promise.resolve({ ok: true as const, value: { bags: [] as Bag[] } }) : api.get<{ bags: Bag[] }>(`/v1/bags?hub_id=${encodeURIComponent(asked)}`)), [asked]);
  const trips = useLoad(() => api.get<{ trips: Trip[] }>("/v1/trips"), []);

  return (
    <>
      <Panel title={t("console.linehaul")}>
        <Row>
          <Field name="hub" label={t("console.hub_id")} value={hub} onChange={setHub} placeholder="BLR1" />
          <Button primary onClick={() => { setAsked(hub); }}>{t("console.search")}</Button>
        </Row>
        <Await loaded={bags.loaded}>
          {({ bags: rows }) => (
            <Table<Bag>
              keyOf={(b) => b.id}
              rows={rows}
              columns={[
                { key: "id", label: t("console.reference"), render: (b) => <Id value={b.id} /> },
                { key: "status", label: t("console.status"), render: (b) => <Status kind={statusOf(b.status)} label={b.status} /> },
                { key: "seal", label: "Seal", render: (b) => b.seal_number ?? "" },
                { key: "count", label: t("console.stops"), numeric: true, render: (b) => String(b.consignment_ids.length) },
              ]}
            />
          )}
        </Await>
      </Panel>
      <Panel title={t("console.run")} actions={<Button onClick={trips.reload}>{t("console.refresh")}</Button>}>
        <Await loaded={trips.loaded}>
          {({ trips: rows }) => (
            <Table<Trip>
              keyOf={(tr) => tr.id}
              rows={rows}
              columns={[
                { key: "id", label: t("console.reference"), render: (tr) => <Id value={tr.id} /> },
                { key: "status", label: t("console.status"), render: (tr) => <Status kind={statusOf(tr.status)} label={tr.status} /> },
                { key: "lane", label: t("console.lane"), render: (tr) => `${tr.originHubId} → ${tr.destinationHubId}` },
                { key: "date", label: t("console.date"), render: (tr) => tr.departsOn },
                { key: "driver", label: t("console.driver_id"), render: (tr) => tr.driverId ?? "" },
                { key: "bags", label: "Bags", numeric: true, render: (tr) => String(tr.bagIds.length) },
              ]}
            />
          )}
        </Await>
      </Panel>
    </>
  );
}
