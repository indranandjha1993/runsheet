CREATE TABLE IF NOT EXISTS runs (
  id                  TEXT        PRIMARY KEY,
  tenant_id           TEXT        NOT NULL,
  hub_id              TEXT        NOT NULL,
  run_date            DATE        NOT NULL,
  status              TEXT        NOT NULL,
  worker_id           TEXT,
  vehicle_id          TEXT,
  declared_cash_minor BIGINT,
  counted_cash_minor  BIGINT,
  forced_close        BOOLEAN     NOT NULL DEFAULT FALSE,
  suspend_reason      TEXT,
  version             BIGINT      NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS runs_by_hub_and_day ON runs (tenant_id, hub_id, run_date);
CREATE INDEX IF NOT EXISTS runs_open ON runs (tenant_id, status)
  WHERE status NOT IN ('closed', 'cancelled');

CREATE TABLE IF NOT EXISTS stops (
  id        TEXT    PRIMARY KEY,
  run_id    TEXT    NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  sequence  INTEGER NOT NULL,
  state     TEXT    NOT NULL,
  CONSTRAINT stops_unique_position UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS stop_actions (
  id                   TEXT   PRIMARY KEY,
  stop_id              TEXT   NOT NULL REFERENCES stops (id) ON DELETE CASCADE,
  kind                 TEXT   NOT NULL,
  consignment_id       TEXT   NOT NULL,
  result               TEXT,
  ndr_reason           TEXT,
  proof_id             TEXT,
  cash_collected_minor BIGINT,
  CONSTRAINT stop_actions_reason_when_not_done
    CHECK (result IS NULL OR result = 'done' OR ndr_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS stop_actions_by_consignment ON stop_actions (consignment_id);

CREATE TABLE IF NOT EXISTS proofs (
  id                   TEXT        PRIMARY KEY,
  tenant_id            TEXT        NOT NULL,
  consignment_id       TEXT        NOT NULL,
  kind                 TEXT        NOT NULL,
  captured_at          TIMESTAMPTZ NOT NULL,
  geofence_ok          BOOLEAN,
  media_ids            TEXT[]      NOT NULL DEFAULT '{}',
  satisfies_requirement BOOLEAN    NOT NULL,
  requirement          TEXT        NOT NULL
);

CREATE INDEX IF NOT EXISTS proofs_by_consignment ON proofs (tenant_id, consignment_id);

CREATE TABLE IF NOT EXISTS aggregate_streams (
  tenant_id     TEXT   NOT NULL,
  aggregate_id  TEXT   NOT NULL,
  last_sequence BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, aggregate_id)
);
