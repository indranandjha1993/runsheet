import type { Pool } from "pg";
import type {
  Decision,
  DecisionState,
  ModelExchange,
  ToolCall,
  Watermark,
} from "../domain/decision.js";
import type { Autonomy, Policy, PolicyState } from "../domain/policy.js";
import type { PolicyRepository } from "../application/ports.js";

interface PolicyRow {
  id: string;
  tenant_id: string;
  name: string;
  version: number;
  code_hash: string;
  autonomy: Autonomy;
  trigger_event: string;
  budget_per_day: number;
  state: PolicyState;
  rollout_percent: number;
  dry_run_decisions: number | null;
  shadow_decisions: number | null;
  agreed_with_humans: number | null;
  rolled_back_by: string | null;
  rollback_reason: string | null;
}

interface DecisionRow {
  id: string;
  tenant_id: string;
  policy_id: string;
  policy_version: number;
  code_hash: string;
  autonomy: Autonomy;
  subject_type: string;
  subject_id: string;
  rollout_bucket: number;
  rollout_percent: number;
  budget_remaining: number;
  read_at: Watermark[];
  tool_calls: ToolCall[];
  inputs: Record<string, unknown>;
  action: Record<string, unknown>;
  state: DecisionState;
  proposed_at: Date;
  shadow: boolean;
  model_version: string | null;
  model_exchange: ModelExchange | null;
  produced_event_ids: string[] | null;
  reviewed_by: string | null;
  reversal_reason: string | null;
}

const orNull = <T>(value: T | undefined): T | null => value ?? null;

function toPolicy(row: PolicyRow): Policy {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    version: row.version,
    codeHash: row.code_hash,
    autonomy: row.autonomy,
    triggerEvent: row.trigger_event,
    budgetPerDay: row.budget_per_day,
    state: row.state,
    rolloutPercent: row.rollout_percent,
    ...(row.dry_run_decisions === null ? {} : { dryRunDecisions: row.dry_run_decisions }),
    ...(row.shadow_decisions === null ? {} : { shadowDecisions: row.shadow_decisions }),
    ...(row.agreed_with_humans === null ? {} : { agreedWithHumans: row.agreed_with_humans }),
    ...(row.rolled_back_by === null ? {} : { rolledBackBy: row.rolled_back_by }),
    ...(row.rollback_reason === null ? {} : { rollbackReason: row.rollback_reason }),
  };
}

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    codeHash: row.code_hash,
    autonomy: row.autonomy,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    rolloutBucket: row.rollout_bucket,
    rolloutPercent: row.rollout_percent,
    budgetRemaining: row.budget_remaining,
    readAt: row.read_at,
    toolCalls: row.tool_calls,
    inputs: row.inputs,
    action: row.action,
    state: row.state,
    proposedAt: row.proposed_at,
    shadow: row.shadow,
    ...(row.model_version === null ? {} : { modelVersion: row.model_version }),
    ...(row.model_exchange === null ? {} : { modelExchange: row.model_exchange }),
    ...(row.produced_event_ids === null ? {} : { producedEventIds: row.produced_event_ids }),
    ...(row.reviewed_by === null ? {} : { reviewedBy: row.reviewed_by }),
    ...(row.reversal_reason === null ? {} : { reversalReason: row.reversal_reason }),
  };
}

function policyValues(policy: Policy): unknown[] {
  return [
    policy.id,
    policy.tenantId,
    policy.name,
    policy.version,
    policy.codeHash,
    policy.autonomy,
    policy.triggerEvent,
    policy.budgetPerDay,
    policy.state,
    policy.rolloutPercent,
    orNull(policy.dryRunDecisions),
    orNull(policy.shadowDecisions),
    orNull(policy.agreedWithHumans),
    orNull(policy.rolledBackBy),
    orNull(policy.rollbackReason),
  ];
}

function decisionValues(decision: Decision): unknown[] {
  return [
    decision.id,
    decision.tenantId,
    decision.policyId,
    decision.policyVersion,
    decision.codeHash,
    decision.autonomy,
    decision.subjectType,
    decision.subjectId,
    decision.rolloutBucket,
    decision.rolloutPercent,
    decision.budgetRemaining,
    JSON.stringify(decision.readAt),
    JSON.stringify(decision.toolCalls),
    JSON.stringify(decision.inputs),
    JSON.stringify(decision.action),
    decision.state,
    decision.proposedAt,
    decision.shadow,
    orNull(decision.modelVersion),
    decision.modelExchange === undefined ? null : JSON.stringify(decision.modelExchange),
    orNull(decision.producedEventIds),
    orNull(decision.reviewedBy),
    orNull(decision.reversalReason),
  ];
}

async function allPoliciesOf(pool: Pool, tenantId: string): Promise<Policy[]> {
  const result = await pool.query<PolicyRow>(
    "SELECT * FROM policies WHERE tenant_id = $1 ORDER BY name, version DESC",
    [tenantId],
  );
  return result.rows.map(toPolicy);
}

function policies(
  pool: Pool,
): Pick<PolicyRepository, "savePolicy" | "policyById" | "policiesFor" | "allPolicies"> {
  return {
    async savePolicy(policy) {
      await pool.query(
        `INSERT INTO policies (id, tenant_id, name, version, code_hash, autonomy, trigger_event,
           budget_per_day, state, rollout_percent, dry_run_decisions, shadow_decisions,
           agreed_with_humans, rolled_back_by, rollback_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state,
           rollout_percent = EXCLUDED.rollout_percent,
           dry_run_decisions = EXCLUDED.dry_run_decisions,
           shadow_decisions = EXCLUDED.shadow_decisions,
           agreed_with_humans = EXCLUDED.agreed_with_humans,
           rolled_back_by = EXCLUDED.rolled_back_by,
           rollback_reason = EXCLUDED.rollback_reason, updated_at = now()`,
        policyValues(policy),
      );
    },
    async policyById(tenantId, id) {
      const result = await pool.query<PolicyRow>(
        "SELECT * FROM policies WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : toPolicy(row);
    },
    allPolicies: (tenantId) => allPoliciesOf(pool, tenantId),

    async policiesFor(tenantId, triggerEvent) {
      const result = await pool.query<PolicyRow>(
        `SELECT * FROM policies WHERE tenant_id = $1 AND trigger_event = $2
         ORDER BY version DESC`,
        [tenantId, triggerEvent],
      );
      return result.rows.map(toPolicy);
    },
  };
}

function decisions(
  pool: Pool,
): Pick<PolicyRepository, "saveDecision" | "decisionById" | "decisionsFor"> {
  return {
    async saveDecision(decision) {
      await pool.query(
        `INSERT INTO decisions (id, tenant_id, policy_id, policy_version, code_hash, autonomy,
           subject_type, subject_id, rollout_bucket, rollout_percent, budget_remaining, read_at,
           tool_calls, inputs, action, state, proposed_at, shadow, model_version, model_exchange,
           produced_event_ids, reviewed_by, reversal_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state,
           produced_event_ids = EXCLUDED.produced_event_ids,
           reviewed_by = EXCLUDED.reviewed_by, reversal_reason = EXCLUDED.reversal_reason,
           updated_at = now()`,
        decisionValues(decision),
      );
    },
    async decisionById(tenantId, id) {
      const result = await pool.query<DecisionRow>(
        "SELECT * FROM decisions WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : toDecision(row);
    },
    async decisionsFor(tenantId, policyId) {
      const result = await pool.query<DecisionRow>(
        "SELECT * FROM decisions WHERE tenant_id = $1 AND policy_id = $2 ORDER BY proposed_at",
        [tenantId, policyId],
      );
      return result.rows.map(toDecision);
    },
  };
}

function budget(pool: Pool): Pick<PolicyRepository, "decisionsToday"> {
  return {
    async decisionsToday(tenantId, policyId, since) {
      const result = await pool.query<{ count: string }>(
        `SELECT count(*) AS count FROM decisions
         WHERE tenant_id = $1 AND policy_id = $2 AND proposed_at >= $3`,
        [tenantId, policyId, since],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
  };
}

function streams(pool: Pool): Pick<PolicyRepository, "nextSequence"> {
  return {
    async nextSequence(tenantId, aggregateId) {
      const result = await pool.query<{ last_sequence: string }>(
        `INSERT INTO aggregate_streams (tenant_id, aggregate_id, last_sequence)
         VALUES ($1, $2, 1)
         ON CONFLICT (tenant_id, aggregate_id)
         DO UPDATE SET last_sequence = aggregate_streams.last_sequence + 1
         RETURNING last_sequence`,
        [tenantId, aggregateId],
      );
      const row = result.rows[0];
      if (row === undefined)
        throw new Error(`could not claim a stream position for ${aggregateId}`);
      return Number(row.last_sequence);
    },
  };
}

export function postgresPolicy(pool: Pool): PolicyRepository {
  return { ...policies(pool), ...decisions(pool), ...budget(pool), ...streams(pool) };
}
