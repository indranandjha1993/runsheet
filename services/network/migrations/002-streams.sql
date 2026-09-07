CREATE TABLE IF NOT EXISTS aggregate_streams (
  tenant_id     TEXT   NOT NULL,
  aggregate_id  TEXT   NOT NULL,
  last_sequence BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, aggregate_id)
);
