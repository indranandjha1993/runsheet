CREATE TABLE IF NOT EXISTS orders (
  id           TEXT        PRIMARY KEY,
  tenant_id    TEXT        NOT NULL,
  reference    TEXT        NOT NULL,
  payment_mode TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_reference_unique_per_tenant UNIQUE (tenant_id, reference)
);

CREATE TABLE IF NOT EXISTS consignments (
  id                TEXT        PRIMARY KEY,
  tenant_id         TEXT        NOT NULL,
  order_id          TEXT        NOT NULL REFERENCES orders (id),
  service           TEXT        NOT NULL,
  payment_mode      TEXT        NOT NULL,
  status            TEXT        NOT NULL,
  attempt_count     INTEGER     NOT NULL DEFAULT 0,
  pickup_attempts   INTEGER     NOT NULL DEFAULT 0,
  damaged           BOOLEAN     NOT NULL DEFAULT FALSE,
  cancel_requested  BOOLEAN     NOT NULL DEFAULT FALSE,
  current_hub_id    TEXT,
  current_run_id    TEXT,
  guards            JSONB       NOT NULL,
  version           BIGINT      NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consignments_attempts_not_negative CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS consignments_by_order ON consignments (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS consignments_open ON consignments (tenant_id, status)
  WHERE status NOT IN ('delivered', 'rto_delivered', 'cancelled');

CREATE TABLE IF NOT EXISTS packages (
  id              TEXT    PRIMARY KEY,
  consignment_id  TEXT    NOT NULL REFERENCES consignments (id) ON DELETE CASCADE,
  weight_grams    INTEGER NOT NULL,
  CONSTRAINT packages_weight_positive CHECK (weight_grams > 0)
);

CREATE TABLE IF NOT EXISTS aggregate_streams (
  tenant_id     TEXT   NOT NULL,
  aggregate_id  TEXT   NOT NULL,
  last_sequence BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, aggregate_id)
);
