CREATE TABLE IF NOT EXISTS policies (
  id                 TEXT        PRIMARY KEY,
  tenant_id          TEXT        NOT NULL,
  name               TEXT        NOT NULL,
  version            INTEGER     NOT NULL,
  code_hash          TEXT        NOT NULL,
  autonomy           TEXT        NOT NULL,
  trigger_event      TEXT        NOT NULL,
  budget_per_day     INTEGER     NOT NULL,
  state              TEXT        NOT NULL,
  rollout_percent    INTEGER     NOT NULL DEFAULT 0,
  dry_run_decisions  INTEGER,
  shadow_decisions   INTEGER,
  agreed_with_humans REAL,
  rolled_back_by     TEXT,
  rollback_reason    TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT policies_one_per_version UNIQUE (tenant_id, name, version),
  CONSTRAINT policies_rollout_is_a_percent CHECK (rollout_percent BETWEEN 0 AND 100),
  CONSTRAINT policies_budget_is_positive CHECK (budget_per_day > 0)
);

CREATE INDEX IF NOT EXISTS policies_live ON policies (tenant_id, trigger_event)
  WHERE state IN ('staged', 'live', 'shadow');

-- Immutable once written. A decision is never edited, only followed by another decision that
-- reverses it, so the trail of what the system did stays complete.
CREATE TABLE IF NOT EXISTS decisions (
  id                 TEXT        PRIMARY KEY,
  tenant_id          TEXT        NOT NULL,
  policy_id          TEXT        NOT NULL,
  policy_version     INTEGER     NOT NULL,
  code_hash          TEXT        NOT NULL,
  autonomy           TEXT        NOT NULL,
  subject_type       TEXT        NOT NULL,
  subject_id         TEXT        NOT NULL,
  rollout_bucket     INTEGER     NOT NULL,
  rollout_percent    INTEGER     NOT NULL,
  budget_remaining   INTEGER     NOT NULL,
  read_at            JSONB       NOT NULL,
  tool_calls         JSONB       NOT NULL,
  inputs             JSONB       NOT NULL,
  action             JSONB       NOT NULL,
  state              TEXT        NOT NULL,
  proposed_at        TIMESTAMPTZ NOT NULL,
  shadow             BOOLEAN     NOT NULL DEFAULT FALSE,
  model_version      TEXT,
  model_exchange     JSONB,
  produced_event_ids TEXT[],
  reviewed_by        TEXT,
  reversal_reason    TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decisions_by_policy ON decisions (tenant_id, policy_id, proposed_at);
CREATE INDEX IF NOT EXISTS decisions_by_subject ON decisions (tenant_id, subject_id);
CREATE INDEX IF NOT EXISTS decisions_awaiting ON decisions (tenant_id, state)
  WHERE state IN ('proposed', 'approved');

-- One policy may act on one subject once. Replaying a stream must not double-approve an invoice.
CREATE UNIQUE INDEX IF NOT EXISTS decisions_one_per_subject
  ON decisions (tenant_id, policy_id, subject_id) WHERE state <> 'shadow_recorded';

CREATE TABLE IF NOT EXISTS aggregate_streams (
  tenant_id     TEXT   NOT NULL,
  aggregate_id  TEXT   NOT NULL,
  last_sequence BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, aggregate_id)
);
