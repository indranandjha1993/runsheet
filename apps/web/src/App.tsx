import { useState, type JSX } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router";
import { AccessProvider, useAccess } from "./platform/api-context.js";
import { consumeLink, type LinkHints } from "./platform/link.js";
import { LocaleProvider, useLocale } from "./platform/locale-context.js";
import { Button } from "./components/primitives.js";
import { Boundary } from "./components/Boundary.js";
import { SignIn } from "./screens/SignIn.js";
import { Board } from "./screens/Board.js";
import { ConsignmentScreen } from "./screens/Consignment.js";
import { Exceptions } from "./screens/Exceptions.js";
import { HubFloor } from "./screens/HubFloor.js";
import { Linehaul } from "./screens/Linehaul.js";
import { Cash } from "./screens/Cash.js";
import { Settlements } from "./screens/Settlements.js";
import { Policies } from "./screens/Policies.js";
import { Reports } from "./screens/Reports.js";
import { Driver } from "./screens/Driver.js";

const SCREENS = [
  { path: "/", key: "console.board", element: <Board /> },
  { path: "/consignments", key: "console.consignments", element: <ConsignmentScreen /> },
  { path: "/exceptions", key: "console.exceptions", element: <Exceptions /> },
  { path: "/hub", key: "console.hub", element: <HubFloor /> },
  { path: "/linehaul", key: "console.linehaul", element: <Linehaul /> },
  { path: "/cash", key: "console.cash", element: <Cash /> },
  { path: "/settlements", key: "console.settlements", element: <Settlements /> },
  { path: "/policies", key: "console.policies", element: <Policies /> },
  { path: "/reports", key: "console.reports", element: <Reports /> },
] as const;

function Console(): JSX.Element {
  const { session, signOut } = useAccess();
  const { t, code, choose } = useLocale();
  if (session === undefined) return <SignIn />;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "13em 1fr", minHeight: "100vh" }}>
      <nav aria-label={t("console.title")} style={{ background: "var(--surface)", borderInlineEnd: "1px solid var(--border-subtle)", padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <strong style={{ font: "var(--text-heading-m)", padding: "var(--space-2)" }}>{t("console.title")}</strong>
        {SCREENS.map((screen) => (
          <NavLink key={screen.path} to={screen.path} end style={({ isActive }) => ({ padding: "var(--space-2)", borderRadius: "var(--radius)", textDecoration: "none", color: "var(--text-primary)", background: isActive ? "var(--status-active-tint)" : "transparent", fontWeight: isActive ? 500 : 400 })}>
            {t(screen.key)}
          </NavLink>
        ))}
        <NavLink to="/driver" style={{ padding: "var(--space-2)", color: "var(--text-secondary)", textDecoration: "none" }}>{t("console.driver")}</NavLink>
        <div style={{ marginTop: "auto", display: "grid", gap: "var(--space-2)" }}>
          <select aria-label={t("console.language")} value={code} onChange={(e) => { choose(e.target.value as typeof code); }} style={{ height: "var(--control-height)", font: "var(--text-body)" }}>
            <option value="en">English</option><option value="hi">हिन्दी</option><option value="ar">العربية</option><option value="xx">Pseudo</option>
          </select>
          <Button onClick={signOut}>{t("console.signout")}</Button>
        </div>
      </nav>
      <main style={{ padding: "var(--space-4)", minWidth: 0 }}>
        <Routes>
          {SCREENS.map((screen) => <Route key={screen.path} path={screen.path} element={<Boundary name={t(screen.key)}>{screen.element}</Boundary>} />)}
        </Routes>
      </main>
    </div>
  );
}

function Shell({ run }: { run?: string | undefined }): JSX.Element {
  const { session } = useAccess();
  const location = useLocation();
  if (location.pathname.startsWith("/driver")) {
    return session === undefined ? <SignIn /> : <Boundary name="driver"><Driver {...(run === undefined ? {} : { openRun: run })} /></Boundary>;
  }
  return <Console />;
}

export function App({ fetcher }: { fetcher?: typeof globalThis.fetch }): JSX.Element {
  // Read once when the app mounts, never again on a re-render.
  const [linkHints] = useState<LinkHints>(consumeLink);
  return (
    <LocaleProvider initial={linkHints.locale}>
      <AccessProvider {...(fetcher === undefined ? {} : { fetcher })} initialKey={linkHints.key}>
        <Shell run={linkHints.run} />
      </AccessProvider>
    </LocaleProvider>
  );
}
