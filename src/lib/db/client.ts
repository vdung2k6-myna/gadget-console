import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadConfig } from "@/lib/config";
import * as schema from "./schema";

/**
 * One pool per process, created on first use rather than at import.
 *
 * The config is read here rather than at module scope so that importing this
 * file during a build — where no database is configured — does not throw. The
 * first query is the moment the console actually needs either value.
 */

let pool: Pool | undefined;

export function getDb() {
  if (pool === undefined) {
    pool = new Pool({ connectionString: loadConfig().databaseUrl });
  }
  return drizzle(pool, { schema });
}

export async function pingDatabase(): Promise<void> {
  const db = getDb();
  await db.execute(sql`select 1`);
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
