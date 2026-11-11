import "dotenv/config";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/lib/db/client";

/**
 * Tests run against their own database, never the development one: every test
 * truncates what it touches, and pointing that at the console's real data would
 * be a mistake waiting for a tired evening.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

export function requireTestDatabase(): void {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL is required: tests truncate the database they run against"
    );
  }
}

export async function resetDb(): Promise<void> {
  await getDb().execute(
    sql`truncate table provider_adapters, audit_events, usage_events, tenant_domains, tenants, firmware_releases, turns, conversations, claims, devices, agents, runtimes, sessions, users cascade`
  );
}

const OWNED_TABLES = [
  "agents",
  "devices",
  "claims",
  "conversations",
  "turns",
  "device_calibration",
] as const;

/**
 * Migration tests must be able to write the legacy shape: owned rows with no
 * tenant. The schema is NOT NULL after the backfill, so those two files drop the
 * constraints for their fixtures and restore them before the next file runs.
 */
export async function relaxTenantNotNull(): Promise<void> {
  for (const table of OWNED_TABLES) {
    await getDb().execute(
      sql.raw(`alter table ${table} alter column tenant_id drop not null`)
    );
  }
}

export async function restoreTenantNotNull(): Promise<void> {
  for (const table of OWNED_TABLES) {
    await getDb().execute(
      sql.raw(`alter table ${table} alter column tenant_id set not null`)
    );
  }
}

export { closeDb, getDb };
