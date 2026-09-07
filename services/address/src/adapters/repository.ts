import type { Pool } from "pg";
import type { Address } from "../domain/address.js";
import type { AddressRepository } from "../application/ports.js";

interface Row {
  id: string;
  tenant_id: string;
  raw: string;
  country_code: string;
  postcode: string | null;
  makani: string | null;
  landmark: string | null;
  unit: string | null;
  completeness: number;
  latitude: number | null;
  longitude: number | null;
  source: "none" | "geocoder" | "driver";
  confidence: number;
  confirmations: number;
  last_confirmed_by: string | null;
  last_confirmed_at: Date | null;
  resolved_at: Date;
}

function toAddress(row: Row): Address {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    parsed: {
      raw: row.raw,
      countryCode: row.country_code,
      completeness: row.completeness,
      ...(row.postcode === null ? {} : { postcode: row.postcode }),
      ...(row.makani === null ? {} : { makani: row.makani }),
      ...(row.landmark === null ? {} : { landmark: row.landmark }),
      ...(row.unit === null ? {} : { unit: row.unit }),
    },
    source: row.source,
    confidence: row.confidence,
    confirmations: row.confirmations,
    resolvedAt: row.resolved_at,
    ...(row.latitude === null || row.longitude === null
      ? {}
      : { location: { latitude: row.latitude, longitude: row.longitude } }),
    ...(row.last_confirmed_by === null ? {} : { lastConfirmedBy: row.last_confirmed_by }),
    ...(row.last_confirmed_at === null ? {} : { lastConfirmedAt: row.last_confirmed_at }),
  };
}

const orNull = <T>(value: T | undefined): T | null => value ?? null;

function valuesOf(address: Address): unknown[] {
  const { parsed, location } = address;
  return [
    address.id,
    address.tenantId,
    parsed.raw,
    parsed.countryCode,
    orNull(parsed.postcode),
    orNull(parsed.makani),
    orNull(parsed.landmark),
    orNull(parsed.unit),
    parsed.completeness,
    orNull(location?.latitude),
    orNull(location?.longitude),
    address.source,
    address.confidence,
    address.confirmations,
    orNull(address.lastConfirmedBy),
    orNull(address.lastConfirmedAt),
    address.resolvedAt,
  ];
}

function addressQueries(pool: Pool): Omit<AddressRepository, "nextSequence"> {
  return {
    async save(address) {
      await pool.query(
        `INSERT INTO addresses (id, tenant_id, raw, country_code, postcode, makani, landmark,
           unit, completeness, latitude, longitude, source, confidence, confirmations,
           last_confirmed_by, last_confirmed_at, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (id) DO UPDATE SET latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude, source = EXCLUDED.source,
           confidence = EXCLUDED.confidence, confirmations = EXCLUDED.confirmations,
           last_confirmed_by = EXCLUDED.last_confirmed_by,
           last_confirmed_at = EXCLUDED.last_confirmed_at`,
        valuesOf(address),
      );
    },

    async byId(tenantId, id) {
      const result = await pool.query<Row>(
        "SELECT * FROM addresses WHERE tenant_id = $1 AND id = $2",
        [tenantId, id],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : toAddress(row);
    },

    async byText(tenantId, raw) {
      const result = await pool.query<Row>(
        "SELECT * FROM addresses WHERE tenant_id = $1 AND md5(raw) = md5($2)",
        [tenantId, raw],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : toAddress(row);
    },
  };
}

function streamQueries(pool: Pool): Pick<AddressRepository, "nextSequence"> {
  return {
    async nextSequence(tenantId, aggregateId) {
      const result = await pool.query<{ last_sequence: string }>(
        `INSERT INTO aggregate_streams (tenant_id, aggregate_id, last_sequence)
         VALUES ($1, $2, 1)
         ON CONFLICT (tenant_id, aggregate_id)
         DO UPDATE SET last_sequence = aggregate_streams.last_sequence + 1
         RETURNING last_sequence`,
        [tenantId, aggregateId],
      );
      const row = result.rows[0];
      if (row === undefined)
        throw new Error(`could not claim a stream position for ${aggregateId}`);
      return Number(row.last_sequence);
    },
  };
}

export function postgresAddresses(pool: Pool): AddressRepository {
  return { ...addressQueries(pool), ...streamQueries(pool) };
}
