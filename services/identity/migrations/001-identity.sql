CREATE TABLE IF NOT EXISTS tenants (
  id           TEXT        PRIMARY KEY,
  name         TEXT        NOT NULL,
  country_code CHAR(2)     NOT NULL,
  currency     CHAR(3)     NOT NULL,
  locale       TEXT        NOT NULL,
  region       TEXT        NOT NULL,
  active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id          TEXT        PRIMARY KEY,
  tenant_id   TEXT        NOT NULL REFERENCES tenants (id),
  name        TEXT        NOT NULL,
  scopes      TEXT[]      NOT NULL,
  secret_hash TEXT        NOT NULL,
  fingerprint TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  CONSTRAINT api_keys_have_scopes CHECK (cardinality(scopes) > 0)
);

-- Lookup is by hash, never by anything the caller controls beyond the secret itself.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_by_hash ON api_keys (secret_hash);
CREATE INDEX IF NOT EXISTS api_keys_by_tenant ON api_keys (tenant_id) WHERE revoked_at IS NULL;
