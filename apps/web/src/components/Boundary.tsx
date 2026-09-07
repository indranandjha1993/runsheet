import { Component, type JSX, type ReactNode } from "react";

interface State {
  readonly failed?: string;
}

// One screen failing must not take the whole console down, and a blank page tells nobody
// anything. The screen is replaced by what went wrong; the rest keeps working.
export class Boundary extends Component<{ children: ReactNode; name: string }, State> {
  override state: State = {};

  static getDerivedStateFromError(error: unknown): State {
    return { failed: error instanceof Error ? error.message : String(error) };
  }

  override render(): JSX.Element {
    if (this.state.failed !== undefined) {
      return (
        <p role="alert" style={{ margin: 0, padding: "var(--space-4)", color: "var(--status-breached-ink)", background: "var(--status-breached-tint)", borderRadius: "var(--radius)" }}>
          {this.props.name}: {this.state.failed}
        </p>
      );
    }
    return <>{this.props.children}</>;
  }
}
