CREATE TABLE IF NOT EXISTS promises (
  consignment_id     TEXT        PRIMARY KEY,
  tenant_id          TEXT        NOT NULL,
  window_start       TIMESTAMPTZ NOT NULL,
  window_end         TIMESTAMPTZ NOT NULL,
  estimated_arrival  TIMESTAMPTZ,
  last_notified_eta  TIMESTAMPTZ,
  at_risk            BOOLEAN     NOT NULL DEFAULT FALSE,
  settled            BOOLEAN     NOT NULL DEFAULT FALSE,
  last_milestone     TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promises_window_is_a_window CHECK (window_end > window_start)
);

CREATE INDEX IF NOT EXISTS promises_at_risk ON promises (tenant_id) WHERE at_risk AND NOT settled;

CREATE TABLE IF NOT EXISTS notifications (
  id             TEXT        PRIMARY KEY,
  tenant_id      TEXT        NOT NULL,
  consignment_id TEXT        NOT NULL,
  channel        TEXT        NOT NULL,
  template       TEXT        NOT NULL,
  locale         TEXT        NOT NULL,
  sent_at        TIMESTAMPTZ,
  failed_reason  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_by_consignment
  ON notifications (tenant_id, consignment_id, created_at);

CREATE TABLE IF NOT EXISTS aggregate_streams (
  tenant_id     TEXT   NOT NULL,
  aggregate_id  TEXT   NOT NULL,
  last_sequence BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, aggregate_id)
);
