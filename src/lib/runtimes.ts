import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { runtimes } from "@/lib/db/schema";

/**
 * A runtime is where a turn is actually answered: one base URL, one credential,
 * and the engines and languages that credential can speak. Agents point at a
 * runtime rather than carrying an address and a secret each, so rotating the
 * credential is one row.
 *
 * The token is the runtime's, server to server. Every browser-facing shape goes
 * through `publicRuntime`, which has no field to leak it with.
 */

export type Runtime = typeof runtimes.$inferSelect;
export type PublicRuntime = Omit<Runtime, "token">;

export interface RuntimeInput {
  name: string;
  baseUrl: string;
  token: string;
  engines: string[];
  languages: string[];
}

export function publicRuntime(runtime: Runtime): PublicRuntime {
  const { token: _token, ...rest } = runtime;
  return rest;
}

export async function createRuntime(input: RuntimeInput): Promise<Runtime> {
  const rows = await getDb().insert(runtimes).values(input).returning();
  return rows[0]!;
}

/** The browser-facing list: no token, by construction. */
export async function listRuntimes(): Promise<PublicRuntime[]> {
  const rows = await getDb().select().from(runtimes);
  return rows.map(publicRuntime);
}

export async function findRuntime(id: string): Promise<Runtime | undefined> {
  const rows = await getDb().select().from(runtimes).where(eq(runtimes.id, id)).limit(1);
  return rows[0];
}

export async function findRuntimeByName(name: string): Promise<Runtime | undefined> {
  const rows = await getDb().select().from(runtimes).where(eq(runtimes.name, name)).limit(1);
  return rows[0];
}

/** Idempotent by name, so seeding a deployment twice is not an error. */
export async function ensureRuntime(input: RuntimeInput): Promise<Runtime> {
  const existing = await findRuntimeByName(input.name);
  return existing ?? createRuntime(input);
}
