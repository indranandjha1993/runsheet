import { useState, type JSX } from "react";
import { useAccess } from "../platform/api-context.js";
import { useLocale } from "../platform/locale-context.js";
import { Button, Field } from "../components/primitives.js";

export function SignIn(): JSX.Element {
  const { signIn } = useAccess();
  const { t } = useLocale();
  const [key, setKey] = useState("");
  const [problem, setProblem] = useState<string | undefined>();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        try {
          signIn(key);
        } catch (error) {
          setProblem(error instanceof Error ? error.message : "could not sign in");
        }
      }}
      style={{ maxWidth: "28em", margin: "var(--space-16) auto", display: "grid", gap: "var(--space-3)", padding: "var(--space-6)", background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius)" }}
    >
      <h1 style={{ margin: 0, font: "var(--text-heading-l)" }}>{t("console.title")}</h1>
      <Field name="key" label={t("console.signin")} value={key} onChange={setKey} type="password" placeholder="rsk_…" />
      {problem === undefined ? null : <p role="alert" style={{ margin: 0, color: "var(--status-breached-ink)" }}>{problem}</p>}
      <Button type="submit" primary>{t("console.signin.action")}</Button>
    </form>
  );
}
