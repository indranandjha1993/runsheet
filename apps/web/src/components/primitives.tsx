import type { CSSProperties, JSX, ReactNode } from "react";
import { useLocale } from "../platform/locale-context.js";
import type { Loaded } from "../platform/use-load.js";

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }): JSX.Element {
  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius)",
        marginBottom: "var(--space-4)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-2) var(--space-3)",
          borderBottom: "1px solid var(--border-subtle)",
          font: "var(--text-heading-s)",
        }}
      >
        <h2 style={{ margin: 0, font: "inherit" }}>{title}</h2>
        {actions === undefined ? null : <div style={{ display: "flex", gap: "var(--space-2)" }}>{actions}</div>}
      </header>
      <div>{children}</div>
    </section>
  );
}

const button: CSSProperties = {
  height: "var(--control-height)",
  padding: "0 var(--space-3)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  font: "var(--text-body)",
  cursor: "pointer",
};

export function Button({
  children,
  onClick,
  primary,
  disabled,
  type,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}): JSX.Element {
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...button,
        ...(primary === true
          ? { background: "var(--action-primary)", color: "var(--surface)", borderColor: "var(--action-primary)", fontWeight: 500 }
          : {}),
        ...(disabled === true ? { opacity: 0.5, cursor: "default" } : {}),
      }}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  type,
  placeholder,
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  name?: string;
}): JSX.Element {
  return (
    <label style={{ display: "grid", gap: "var(--space-1)", font: "var(--text-caption)", color: "var(--text-secondary)" }}>
      {label}
      <input
        name={name}
        type={type ?? "text"}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        style={{
          height: "var(--control-height)",
          padding: "0 var(--space-2)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius)",
          font: "var(--text-body)",
          color: "var(--text-primary)",
          background: "var(--surface)",
          minWidth: "10em",
        }}
      />
    </label>
  );
}

export function Row({ children }: { children: ReactNode }): JSX.Element {
  return <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "end", flexWrap: "wrap", padding: "var(--space-3)" }}>{children}</div>;
}

export interface Column<T> {
  readonly key: string;
  readonly label: string;
  readonly render: (row: T) => ReactNode;
  readonly numeric?: boolean;
}

// Dense rows for somebody triaging all day. Numbers are lining and right-aligned so they compare.
export function Table<T>({ columns, rows, keyOf, onPick }: { columns: readonly Column<T>[]; rows: readonly T[]; keyOf: (row: T) => string; onPick?: (row: T) => void }): JSX.Element {
  const { t } = useLocale();
  if (rows.length === 0) {
    return <p style={{ margin: 0, padding: "var(--space-4)", color: "var(--text-secondary)" }}>{t("console.empty")}</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", font: "var(--text-body-s)" }}>
        <thead>
          <tr style={{ position: "sticky", top: 0, background: "var(--sunken)" }}>
            {columns.map((column) => (
              <th key={column.key} style={{ textAlign: column.numeric === true ? "end" : "start", padding: "var(--cell-padding)", fontWeight: 500, color: "var(--text-secondary)", height: "var(--row-height)", whiteSpace: "nowrap" }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={keyOf(row)} onClick={onPick === undefined ? undefined : () => { onPick(row); }} style={{ borderTop: "1px solid var(--border-subtle)", height: "var(--row-height)", cursor: onPick === undefined ? "default" : "pointer" }}>
              {columns.map((column) => (
                <td key={column.key} style={{ padding: "var(--cell-padding)", textAlign: column.numeric === true ? "end" : "start", whiteSpace: "nowrap" }}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Await<T>({ loaded, children }: { loaded: Loaded<T>; children: (value: T) => ReactNode }): JSX.Element {
  const { t } = useLocale();
  if (loaded.state === "loading") return <p style={{ margin: 0, padding: "var(--space-4)", color: "var(--text-secondary)" }}>{t("console.loading")}</p>;
  if (loaded.state === "failed") {
    return (
      <p role="alert" style={{ margin: 0, padding: "var(--space-4)", color: "var(--status-breached-ink)", background: "var(--status-breached-tint)" }}>
        {t("console.error", { message: loaded.error.message })}
        {loaded.error.traceparent === undefined ? null : <span style={{ display: "block", font: "var(--text-caption)" }}>{loaded.error.traceparent}</span>}
      </p>
    );
  }
  return <>{children(loaded.value)}</>;
}

// An identifier inside right-to-left text is wrapped so it cannot be reordered.
export function Id({ value }: { value: string }): JSX.Element {
  return <bdi style={{ fontVariantNumeric: "tabular-nums" }}>{value}</bdi>;
}

export function Money({ minor, currency }: { minor: number; currency: string }): JSX.Element {
  return <span style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>{(minor / 100).toFixed(2)} {currency}</span>;
}
