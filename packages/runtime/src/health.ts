export interface Probe {
  readonly name: string;
  check(): Promise<void>;
}

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface HealthReport {
  readonly status: "ready" | "not_ready";
  readonly checks: CheckResult[];
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout(probe: Probe, ms: number): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("timed out"));
    }, ms);
  });

  try {
    await Promise.race([probe.check(), expiry]);
    return { name: probe.name, ok: true };
  } catch (error) {
    return { name: probe.name, ok: false, detail: reason(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function healthReport(probes: Probe[], timeoutMs = 2000): Promise<HealthReport> {
  const checks = await Promise.all(probes.map((probe) => withTimeout(probe, timeoutMs)));
  return {
    status: checks.every((check) => check.ok) ? "ready" : "not_ready",
    checks,
  };
}
