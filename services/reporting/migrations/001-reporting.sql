-- Projections, not aggregates of aggregates. Each row is one day of one thing, written by the
-- consumers that follow the event streams, so a report is a scan of a narrow table.

CREATE TABLE IF NOT EXISTS consignment_outcomes (
  tenant_id   TEXT    NOT NULL,
  occurred_on DATE    NOT NULL,
  hub_id      TEXT    NOT NULL,
  -- An outcome with nothing to explain carries an empty reason rather than a null, so the
  -- primary key stays a plain list of columns.
  reason      TEXT    NOT NULL DEFAULT '',
  delivered   INTEGER NOT NULL DEFAULT 0,
  attempted   INTEGER NOT NULL DEFAULT 0,
  returned    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, occurred_on, hub_id, reason)
);

CREATE TABLE IF NOT EXISTS cash_positions (
  tenant_id        TEXT    NOT NULL,
  occurred_on      DATE    NOT NULL,
  driver_id        TEXT    NOT NULL,
  currency         TEXT    NOT NULL,
  collected_minor  BIGINT  NOT NULL DEFAULT 0,
  deposited_minor  BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, occurred_on, driver_id, currency)
);

CREATE TABLE IF NOT EXISTS hub_activity (
  tenant_id    TEXT    NOT NULL,
  occurred_on  DATE    NOT NULL,
  hub_id       TEXT    NOT NULL,
  scanned_in   INTEGER NOT NULL DEFAULT 0,
  scanned_out  INTEGER NOT NULL DEFAULT 0,
  exceptions   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, occurred_on, hub_id)
);

CREATE TABLE IF NOT EXISTS exception_ageing (
  tenant_id    TEXT    NOT NULL,
  exception_id TEXT    NOT NULL,
  opened_on    DATE    NOT NULL,
  type         TEXT    NOT NULL,
  severity     TEXT    NOT NULL,
  open_hours   NUMERIC NOT NULL,
  PRIMARY KEY (tenant_id, exception_id)
);

CREATE TABLE IF NOT EXISTS linehaul_trips (
  tenant_id     TEXT    NOT NULL,
  trip_id       TEXT    NOT NULL,
  departed_on   DATE    NOT NULL,
  lane          TEXT    NOT NULL,
  bags          INTEGER NOT NULL DEFAULT 0,
  capacity_bags INTEGER NOT NULL DEFAULT 0,
  missing_bags  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, trip_id)
);

CREATE INDEX IF NOT EXISTS consignment_outcomes_by_day
  ON consignment_outcomes (tenant_id, occurred_on);
CREATE INDEX IF NOT EXISTS cash_positions_by_day ON cash_positions (tenant_id, occurred_on);
CREATE INDEX IF NOT EXISTS hub_activity_by_day ON hub_activity (tenant_id, occurred_on);
CREATE INDEX IF NOT EXISTS exception_ageing_by_day ON exception_ageing (tenant_id, opened_on);
CREATE INDEX IF NOT EXISTS linehaul_trips_by_day ON linehaul_trips (tenant_id, departed_on);
