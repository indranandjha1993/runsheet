CREATE TABLE IF NOT EXISTS consumer_watermarks (
  consumer       TEXT   NOT NULL,
  tenant_id      TEXT   NOT NULL,
  aggregate_id   TEXT   NOT NULL,
  last_sequence  BIGINT NOT NULL,
  PRIMARY KEY (consumer, tenant_id, aggregate_id)
);

CREATE TABLE IF NOT EXISTS dead_letters (
  event_id    TEXT        NOT NULL,
  consumer    TEXT        NOT NULL,
  reason      TEXT        NOT NULL,
  payload     JSONB       NOT NULL,
  failed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer)
);
