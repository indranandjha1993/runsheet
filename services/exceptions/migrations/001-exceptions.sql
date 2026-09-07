CREATE TABLE IF NOT EXISTS exceptions (
  id                     TEXT        PRIMARY KEY,
  tenant_id              TEXT        NOT NULL,
  type                   TEXT        NOT NULL,
  subject_type           TEXT        NOT NULL,
  subject_id             TEXT        NOT NULL,
  detail                 JSONB       NOT NULL,
  severity               TEXT        NOT NULL,
  state                  TEXT        NOT NULL,
  started_at             TIMESTAMPTZ NOT NULL,
  allowance_minutes      INTEGER     NOT NULL,
  paused_at              TIMESTAMPTZ,
  paused_minutes         REAL        NOT NULL DEFAULT 0,
  sla_breached           BOOLEAN     NOT NULL DEFAULT FALSE,
  reopen_count           INTEGER     NOT NULL DEFAULT 0,
  assigned_to            TEXT,
  resolved_by            TEXT,
  resolution_note        TEXT,
  resolved_automatically BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open exception per problem per subject. Replaying an event stream must not raise the same
-- problem twice, and this is what guarantees it rather than hoping the consumer is careful.
CREATE UNIQUE INDEX IF NOT EXISTS exceptions_one_open_per_subject
  ON exceptions (tenant_id, type, subject_id) WHERE state <> 'resolved';

CREATE INDEX IF NOT EXISTS exceptions_queue
  ON exceptions (tenant_id, severity, started_at) WHERE state <> 'resolved';

CREATE TABLE IF NOT EXISTS aggregate_streams (
  tenant_id     TEXT   NOT NULL,
  aggregate_id  TEXT   NOT NULL,
  last_sequence BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, aggregate_id)
);
