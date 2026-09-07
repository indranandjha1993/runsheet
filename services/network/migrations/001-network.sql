CREATE TABLE IF NOT EXISTS hubs (
  id                    TEXT        PRIMARY KEY,
  tenant_id             TEXT        NOT NULL,
  code                  TEXT        NOT NULL,
  name                  TEXT        NOT NULL,
  country_code          CHAR(2)     NOT NULL,
  time_zone             TEXT        NOT NULL,
  latitude              DOUBLE PRECISION NOT NULL,
  longitude             DOUBLE PRECISION NOT NULL,
  opens_minutes_of_day  INTEGER     NOT NULL,
  closes_minutes_of_day INTEGER     NOT NULL,
  active                BOOLEAN     NOT NULL DEFAULT TRUE,
  CONSTRAINT hubs_code_unique_per_tenant UNIQUE (tenant_id, code),
  CONSTRAINT hubs_open_before_close CHECK (opens_minutes_of_day < closes_minutes_of_day)
);

CREATE TABLE IF NOT EXISTS zones (
  id         TEXT    PRIMARY KEY,
  tenant_id  TEXT    NOT NULL,
  hub_id     TEXT    NOT NULL REFERENCES hubs (id),
  priority   INTEGER NOT NULL DEFAULT 0,
  boundary   JSONB   NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS zones_by_tenant ON zones (tenant_id) WHERE active;

CREATE TABLE IF NOT EXISTS lanes (
  id                    TEXT    PRIMARY KEY,
  tenant_id             TEXT    NOT NULL,
  origin_hub_id         TEXT    NOT NULL REFERENCES hubs (id),
  destination_hub_id    TEXT    NOT NULL,
  service               TEXT    NOT NULL,
  transit_hours         NUMERIC NOT NULL,
  cutoff_minutes_of_day INTEGER NOT NULL,
  operating_days        INTEGER[] NOT NULL,
  CONSTRAINT lanes_connect_two_hubs CHECK (origin_hub_id <> destination_hub_id),
  CONSTRAINT lanes_transit_positive CHECK (transit_hours > 0)
);

CREATE INDEX IF NOT EXISTS lanes_by_origin ON lanes (tenant_id, origin_hub_id);
