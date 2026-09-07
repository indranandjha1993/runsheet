CREATE TABLE IF NOT EXISTS hub_scans (
  id               TEXT        PRIMARY KEY,
  tenant_id        TEXT        NOT NULL,
  hub_id           TEXT        NOT NULL,
  worker_id        TEXT        NOT NULL,
  consignment_id   TEXT        NOT NULL,
  direction        TEXT        NOT NULL,
  run_id           TEXT,
  scanned_at       TIMESTAMPTZ NOT NULL,
  accepted         BOOLEAN     NOT NULL,
  weight_grams     INTEGER,
  volumetric_grams INTEGER,
  exception        TEXT,
  CONSTRAINT hub_scans_direction CHECK (direction IN ('in', 'out')),
  CONSTRAINT hub_scans_outscan_names_a_run CHECK (direction = 'in' OR run_id IS NOT NULL),
  CONSTRAINT hub_scans_weight_is_positive CHECK (weight_grams IS NULL OR weight_grams > 0)
);

CREATE INDEX IF NOT EXISTS hub_scans_by_consignment
  ON hub_scans (tenant_id, consignment_id, scanned_at);
CREATE INDEX IF NOT EXISTS hub_scans_open_exceptions
  ON hub_scans (tenant_id, hub_id, scanned_at) WHERE exception IS NOT NULL;
