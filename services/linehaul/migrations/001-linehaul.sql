CREATE TABLE IF NOT EXISTS bags (
  id                  TEXT        PRIMARY KEY,
  tenant_id           TEXT        NOT NULL,
  origin_hub_id       TEXT        NOT NULL,
  destination_hub_id  TEXT        NOT NULL,
  status              TEXT        NOT NULL,
  seal_number         TEXT,
  trip_id             TEXT,
  received_at_hub_id  TEXT,
  seal_broken         BOOLEAN     NOT NULL DEFAULT FALSE,
  misrouted           BOOLEAN     NOT NULL DEFAULT FALSE,
  missing_ids         TEXT[]      NOT NULL DEFAULT '{}',
  unexpected_ids      TEXT[]      NOT NULL DEFAULT '{}',
  version             BIGINT      NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bags_go_somewhere_else CHECK (origin_hub_id <> destination_hub_id),
  CONSTRAINT bags_status CHECK (status IN ('open', 'sealed', 'in_transit', 'received', 'emptied')),
  CONSTRAINT bags_are_sealed_before_they_move
    CHECK (status IN ('open', 'sealed') OR seal_number IS NOT NULL)
);

-- One open bag per lane per hub. A second would split a lane's parcels for no reason and make
-- the receiving hub reconcile the same lane twice.
CREATE UNIQUE INDEX IF NOT EXISTS bags_one_open_per_lane
  ON bags (tenant_id, origin_hub_id, destination_hub_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS bags_by_trip ON bags (tenant_id, trip_id) WHERE trip_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS bag_parcels (
  bag_id         TEXT    NOT NULL REFERENCES bags (id) ON DELETE CASCADE,
  consignment_id TEXT    NOT NULL,
  position       INTEGER NOT NULL,
  PRIMARY KEY (bag_id, consignment_id)
);

CREATE TABLE IF NOT EXISTS trips (
  id                  TEXT        PRIMARY KEY,
  tenant_id           TEXT        NOT NULL,
  origin_hub_id       TEXT        NOT NULL,
  destination_hub_id  TEXT        NOT NULL,
  departs_on          DATE        NOT NULL,
  capacity_bags       INTEGER     NOT NULL,
  status              TEXT        NOT NULL,
  vehicle_id          TEXT,
  driver_id           TEXT,
  arrived_at_hub_id   TEXT,
  diverted_to         TEXT,
  missing_bag_ids     TEXT[]      NOT NULL DEFAULT '{}',
  cancel_reason       TEXT,
  version             BIGINT      NOT NULL DEFAULT 0,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trips_go_somewhere_else CHECK (origin_hub_id <> destination_hub_id),
  CONSTRAINT trips_have_room CHECK (capacity_bags > 0),
  CONSTRAINT trips_status
    CHECK (status IN ('planned', 'crewed', 'departed', 'arrived', 'closed', 'cancelled')),
  CONSTRAINT trips_are_crewed_before_they_leave
    CHECK (status IN ('planned', 'cancelled') OR (vehicle_id IS NOT NULL AND driver_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS trips_by_lane_and_day
  ON trips (tenant_id, origin_hub_id, destination_hub_id, departs_on);

CREATE TABLE IF NOT EXISTS trip_bags (
  trip_id  TEXT    NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  bag_id   TEXT    NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (trip_id, bag_id)
);

CREATE TABLE IF NOT EXISTS aggregate_streams (
  tenant_id     TEXT   NOT NULL,
  aggregate_id  TEXT   NOT NULL,
  last_sequence BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, aggregate_id)
);
