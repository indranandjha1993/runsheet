-- A consignment has always had a lane in reality; now it has one in the record, so it can be
-- priced against a rate card and planned onto a trip without asking anybody. The delivery time
-- is what a carrier invoice is matched against.
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS origin_hub_code      TEXT NOT NULL DEFAULT '';
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS destination_hub_code TEXT NOT NULL DEFAULT '';
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS delivered_at         TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS consignments_by_lane
  ON consignments (tenant_id, origin_hub_code, destination_hub_code);
