CREATE TABLE IF NOT EXISTS plans (
  id                TEXT        PRIMARY KEY,
  tenant_id         TEXT        NOT NULL,
  hub_id            TEXT        NOT NULL,
  plan_date         DATE        NOT NULL,
  vehicle_id        TEXT        NOT NULL,
  estimated_minutes INTEGER     NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plans_by_day ON plans (tenant_id, hub_id, plan_date);

CREATE TABLE IF NOT EXISTS plan_stops (
  plan_id  TEXT    NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  job_id   TEXT    NOT NULL,
  PRIMARY KEY (plan_id, sequence)
);

CREATE TABLE IF NOT EXISTS aggregate_streams (
  tenant_id     TEXT   NOT NULL,
  aggregate_id  TEXT   NOT NULL,
  last_sequence BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, aggregate_id)
);
