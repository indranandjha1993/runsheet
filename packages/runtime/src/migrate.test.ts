import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "./migrate.js";

const pool = new Pool({
  host: "localhost",
  port: 15432,
  user: "runsheet",
  password: "runsheet",
  database: "network",
});

const dir = new URL("../test-migrations", import.meta.url).pathname;

async function tableExists(name: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [name],
  );
  return result.rows[0]?.exists === true;
}

beforeEach(async () => {
  await pool.query("DROP TABLE IF EXISTS widgets, gadgets, schema_migrations");
});

afterAll(async () => {
  await pool.end();
});

describe("migration runner", () => {
  it("applies every migration in filename order", async () => {
    const applied = await migrate(pool, dir);

    expect(applied).toEqual(["001-widgets.sql", "002-label.sql", "003-gadgets.sql"]);
    expect(await tableExists("widgets")).toBe(true);
    expect(await tableExists("gadgets")).toBe(true);
  });

  it("applies nothing on a second run", async () => {
    await migrate(pool, dir);

    expect(await migrate(pool, dir)).toEqual([]);
  });

  it("records what it applied so a later migration is picked up", async () => {
    await migrate(pool, dir);
    await pool.query("DELETE FROM schema_migrations WHERE name = '003-gadgets.sql'");
    await pool.query("DROP TABLE gadgets");

    expect(await migrate(pool, dir)).toEqual(["003-gadgets.sql"]);
  });

  it("leaves the database untouched when a migration fails", async () => {
    const broken = new URL("../test-broken", import.meta.url).pathname;

    await expect(migrate(pool, broken)).rejects.toThrow(/002-broken\.sql/);
    expect(await tableExists("widgets")).toBe(false);
  });

  it("refuses to run when an applied migration has been edited", async () => {
    await migrate(pool, dir);
    await pool.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE name = $1", [
      "001-widgets.sql",
    ]);

    await expect(migrate(pool, dir)).rejects.toThrow(
      "001-widgets.sql changed after it was applied",
    );
  });
});
