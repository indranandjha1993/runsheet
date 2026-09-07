import { useState, type JSX } from "react";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { Button, Field, Panel, Row } from "../components/primitives.js";
import { Status } from "../components/Status.js";

interface Scan { accepted: boolean; exception?: string; weight_grams?: number }

// The scanning screen. A barcode field with focus, a hub, and two big actions. What the
// platform said comes straight back onto the screen, refusal included.
export function HubFloor(): JSX.Element {
  const { api } = useAccess();
  const { t } = useLocale();
  const [hub, setHub] = useState("");
  const [worker, setWorker] = useState("");
  const [consignment, setConsignment] = useState("");
  const [barcode, setBarcode] = useState("");
  const [weight, setWeight] = useState("");
  const [run, setRun] = useState("");
  const [last, setLast] = useState<{ kind: "ok" | "refused"; text: string } | undefined>();

  const scanIn = async (): Promise<void> => {
    const result = await api.post<Scan>("/v1/hub-scans/in", {
      hub_id: hub, worker_id: worker, consignment_id: consignment, barcode, expected: true,
      ...(weight === "" ? {} : { weight_grams: Number(weight) }),
    });
    setLast(result.ok
      ? { kind: result.value.exception === undefined ? "ok" : "refused", text: result.value.exception ?? t("console.scanned") }
      : { kind: "refused", text: t("console.refused", { reason: result.error.message }) });
    setBarcode("");
  };

  const scanOut = async (): Promise<void> => {
    const result = await api.post<Scan>("/v1/hub-scans/out", { hub_id: hub, worker_id: worker, consignment_id: consignment, barcode, run_id: run, on_run: true });
    setLast(result.ok ? { kind: "ok", text: t("console.scanned") } : { kind: "refused", text: t("console.refused", { reason: result.error.message }) });
    setBarcode("");
  };

  return (
    <Panel title={t("console.hub")}>
      <Row>
        <Field name="hub" label={t("console.hub_id")} value={hub} onChange={setHub} placeholder="BLR1" />
        <Field name="worker" label={t("console.driver_id")} value={worker} onChange={setWorker} />
        <Field name="consignment" label={t("console.reference")} value={consignment} onChange={setConsignment} />
        <Field name="barcode" label={t("console.barcode")} value={barcode} onChange={setBarcode} placeholder="RS…" />
        <Field name="weight" label={t("console.weight")} value={weight} onChange={setWeight} type="number" />
        <Field name="run" label={t("console.run")} value={run} onChange={setRun} />
      </Row>
      <Row>
        <Button primary onClick={() => { void scanIn(); }}>{t("console.scan_in")}</Button>
        <Button onClick={() => { void scanOut(); }}>{t("console.scan_out")}</Button>
        {last === undefined ? null : <Status kind={last.kind === "ok" ? "done" : "breached"} label={last.text} />}
      </Row>
    </Panel>
  );
}
