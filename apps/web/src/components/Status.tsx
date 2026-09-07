import type { JSX } from "react";

// A status is carried by ink, tint, and a mark together, so a colour deficiency and a
// sun-washed screen both survive it. Hue is never the only channel.
export type StatusKind = "pending" | "active" | "at_risk" | "breached" | "done";

const MARK: Record<StatusKind, string> = {
  pending: "○",
  active: "▶",
  at_risk: "◣",
  breached: "▲",
  done: "✓",
};

const VAR: Record<StatusKind, string> = {
  pending: "pending",
  active: "active",
  at_risk: "at-risk",
  breached: "breached",
  done: "done",
};

export function Status({ kind, label }: { kind: StatusKind; label: string }): JSX.Element {
  const name = VAR[kind];
  return (
    <span
      data-status={kind}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "0 var(--space-2)",
        height: "22px",
        borderRadius: "var(--radius)",
        color: `var(--status-${name}-ink)`,
        background: `var(--status-${name}-tint)`,
        font: "var(--text-body-s)",
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true">{MARK[kind]}</span>
      {label}
    </span>
  );
}

// Consignment, run, bag, trip, and settlement states all map onto the five presentation
// statuses, so a dispatcher reads one vocabulary across every screen.
const BY_STATE: Record<string, StatusKind> = {
  booked: "pending",
  planned: "pending",
  open: "pending",
  draft: "pending",
  crewed: "pending",
  picked_up: "active",
  in_hub: "active",
  in_transit: "active",
  out_for_delivery: "active",
  assigned: "active",
  started: "active",
  sealed: "active",
  departed: "active",
  arrived: "active",
  received: "active",
  live: "active",
  shadow: "active",
  staged: "active",
  attempted: "at_risk",
  suspended: "at_risk",
  mismatched: "at_risk",
  disputed: "at_risk",
  missing_evidence: "at_risk",
  rto_initiated: "at_risk",
  lost: "breached",
  damaged: "breached",
  cancelled: "breached",
  rolled_back: "breached",
  delivered: "done",
  rto_delivered: "done",
  completed: "done",
  closed: "done",
  emptied: "done",
  matched: "done",
  approved: "done",
  paid: "done",
  resolved: "done",
  retired: "done",
};

export function statusOf(state: string): StatusKind {
  return BY_STATE[state] ?? "pending";
}
