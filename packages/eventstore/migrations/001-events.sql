CREATE TABLE IF NOT EXISTS events (
  event_id       TEXT PRIMARY KEY,
  tenant_id      TEXT        NOT NULL,
  aggregate_type TEXT        NOT NULL,
  aggregate_id   TEXT        NOT NULL,
  sequence       BIGINT      NOT NULL,
  type           TEXT        NOT NULL,
  version        INTEGER     NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL,
  source         TEXT        NOT NULL
    CONSTRAINT events_known_source CHECK (source IN ('api','device','connector','policy','operator')),
  correlation_id TEXT        NOT NULL,
  causation_id   TEXT,
  confidence     DOUBLE PRECISION,
  payload        JSONB       NOT NULL,
  CONSTRAINT events_stream_position UNIQUE (tenant_id, aggregate_id, sequence)
);

CREATE INDEX IF NOT EXISTS events_stream ON events (tenant_id, aggregate_id, sequence);

CREATE TABLE IF NOT EXISTS outbox (
  event_id     TEXT PRIMARY KEY REFERENCES events (event_id),
  topic        TEXT        NOT NULL,
  partition_key TEXT       NOT NULL,
  published_at TIMESTAMPTZ,
  attempts     INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS outbox_unpublished ON outbox (event_id) WHERE published_at IS NULL;
