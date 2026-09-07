-- One counter for the whole deployment. A barcode identifies a parcel on a hub floor where
-- parcels from every merchant are mixed together, so the number cannot be per tenant.
CREATE TABLE IF NOT EXISTS parcel_serials (
  only_row    BOOLEAN PRIMARY KEY DEFAULT TRUE,
  next_serial BIGINT  NOT NULL DEFAULT 1,
  CONSTRAINT parcel_serials_is_a_single_row CHECK (only_row)
);

INSERT INTO parcel_serials (only_row) VALUES (TRUE) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS consignment_serials (
  tenant_id      TEXT    NOT NULL,
  consignment_id TEXT    NOT NULL,
  first_serial   BIGINT  NOT NULL,
  pieces         INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, consignment_id),
  CONSTRAINT consignment_serials_reserve_at_least_one CHECK (pieces > 0),
  CONSTRAINT consignment_serials_are_unique UNIQUE (first_serial)
);
