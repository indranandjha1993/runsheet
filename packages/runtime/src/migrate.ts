import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";

interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

const LEDGER = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  checksum    TEXT        NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

function load(directory: string): Migration[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(directory, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

async function readApplied(client: PoolClient): Promise<Map<string, string>> {
  const result = await client.query<{ name: string; checksum: string }>(
    "SELECT name, checksum FROM schema_migrations",
  );
  return new Map(result.rows.map((row) => [row.name, row.checksum]));
}

function assertUnchanged(migrations: Migration[], applied: Map<string, string>): void {
  for (const migration of migrations) {
    const recorded = applied.get(migration.name);
    if (recorded !== undefined && recorded !== migration.checksum) {
      throw new Error(`${migration.name} changed after it was applied`);
    }
  }
}

async function applyOne(client: PoolClient, migration: Migration): Promise<void> {
  try {
    await client.query(migration.sql);
  } catch (error) {
    throw new Error(`${migration.name} failed to apply`, { cause: error });
  }
  await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
    migration.name,
    migration.checksum,
  ]);
}

export async function migrate(pool: Pool, directory: string): Promise<string[]> {
  const migrations = load(directory);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(LEDGER);
    const applied = await readApplied(client);
    assertUnchanged(migrations, applied);

    const pending = migrations.filter((migration) => !applied.has(migration.name));
    for (const migration of pending) {
      await applyOne(client, migration);
    }
    await client.query("COMMIT");
    return pending.map((migration) => migration.name);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
