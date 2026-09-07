-- One row per command a handset ever sent. The primary key is what makes a retried batch
-- harmless: the second attempt claims nothing and the driver's work is recorded once.
CREATE TABLE IF NOT EXISTS device_commands (
  tenant_id  TEXT        NOT NULL,
  device_id  TEXT        NOT NULL,
  command_id TEXT        NOT NULL,
  event_id   TEXT        NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_id, command_id),
  CONSTRAINT device_commands_event_is_unique UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS device_commands_by_age ON device_commands (claimed_at);

-- What the device says it holds, recorded before a single byte arrives, so a delivery is never
-- waiting on a photograph.
CREATE TABLE IF NOT EXISTS proof_media (
  media_id    TEXT        PRIMARY KEY,
  tenant_id   TEXT        NOT NULL,
  event_id    TEXT        NOT NULL,
  sha256      TEXT        NOT NULL,
  bytes       BIGINT      NOT NULL,
  kind        TEXT        NOT NULL,
  uploaded_at TIMESTAMPTZ,
  declared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT proof_media_hash_is_a_hash CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT proof_media_bytes_are_positive CHECK (bytes > 0)
);

CREATE INDEX IF NOT EXISTS proof_media_awaiting_upload
  ON proof_media (tenant_id, declared_at) WHERE uploaded_at IS NULL;
