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
    sql`truncate table turns, conversations, claims, devices, agents, runtimes, sessions, users cascade`
  );
}

export { closeDb, getDb };
