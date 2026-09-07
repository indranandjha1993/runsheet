CREATE TABLE IF NOT EXISTS addresses (
  id                TEXT        PRIMARY KEY,
  tenant_id         TEXT        NOT NULL,
  raw               TEXT        NOT NULL,
  country_code      CHAR(2)     NOT NULL,
  postcode          TEXT,
  makani            TEXT,
  landmark          TEXT,
  unit              TEXT,
  completeness      REAL        NOT NULL,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  source            TEXT        NOT NULL,
  confidence        REAL        NOT NULL,
  confirmations     INTEGER     NOT NULL DEFAULT 0,
  last_confirmed_by TEXT,
  last_confirmed_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ NOT NULL,
  CONSTRAINT addresses_confidence_is_a_probability CHECK (confidence >= 0 AND confidence <= 1)
);

-- The learning loop: the same text within a tenant resolves to the same address, so a pin a
-- driver corrected once is reused for every later booking to that door.
CREATE UNIQUE INDEX IF NOT EXISTS addresses_by_text ON addresses (tenant_id, md5(raw));
CREATE INDEX IF NOT EXISTS addresses_by_postcode ON addresses (tenant_id, postcode)
  WHERE postcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS aggregate_streams (
  tenant_id     TEXT   NOT NULL,
  aggregate_id  TEXT   NOT NULL,
  last_sequence BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, aggregate_id)
);
