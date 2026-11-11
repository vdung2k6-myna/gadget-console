import "dotenv/config";

import { sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/lib/db/client";

/**
 * Tighten the owned tables after the pilot backfill.
 *
 * Migration 0021 runs before the backfill on a live deployment, so its
 * `SET NOT NULL` is conditional: a table that still holds legacy rows is left
 * nullable and the operator finishes the job here. This command refuses while a
 * null remains — the backfill has not run — and otherwise sets the constraints,
 * making a second run a no-op.
 */

const TABLES = [
  "agents",
  "claims",
  "conversations",
  "device_calibration",
  "devices",
  "turns",
] as const;

async function scalar(query: ReturnType<typeof sql>): Promise<number> {
  const result = await getDb().execute<{ n: number }>(query);
  return Number(result.rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const unassigned: string[] = [];
  for (const table of TABLES) {
    const count = await scalar(
      sql.raw(`select count(*)::int as n from ${table} where tenant_id is null`)
    );
    if (count > 0) unassigned.push(`${table}=${count}`);
  }

  if (unassigned.length > 0) {
    throw new Error(
      `tenant_id is still null in ${unassigned.join(", ")}; run the pilot backfill first`
    );
  }

  for (const table of TABLES) {
    await getDb().execute(
      sql.raw(`alter table ${table} alter column tenant_id set not null`)
    );
  }
  console.log(`tenant_id is NOT NULL on ${TABLES.join(", ")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
