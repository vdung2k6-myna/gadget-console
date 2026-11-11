import { eq } from "drizzle-orm";

import { registerAccount } from "../../src/lib/auth/accounts";
import { getDb } from "./db";
import { tenants, users } from "../../src/lib/db/schema";

/**
 * A tenant for fixtures whose rows now require one.
 *
 * `tenant_id` is NOT NULL on the owned tables, so a test that creates a device,
 * agent, claim or turn needs a real tenant. One shared fixture tenant is enough;
 * the tenancy-specific tests create their own when they need two.
 */
export async function testTenant(): Promise<string> {
  const existing = await getDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, "fixture"))
    .limit(1);
  if (existing[0] !== undefined) return existing[0].id;

  const inserted = await getDb()
    .insert(tenants)
    .values({ name: "Fixture", slug: "fixture" })
    .onConflictDoNothing({ target: tenants.slug })
    .returning({ id: tenants.id });
  if (inserted[0] !== undefined) return inserted[0].id;

  const raced = await getDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, "fixture"))
    .limit(1);
  return raced[0]!.id;
}

export async function accountWithTenant(
  email: string,
  tenantId?: string
): Promise<{ id: string; email: string }> {
  const result = await registerAccount(
    email,
    "a good password",
    tenantId ?? (await testTenant())
  );
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

/** The tenant a fixture row must carry; throws rather than inventing one. */
export async function tenantOfUser(userId: string): Promise<string> {
  const rows = await getDb()
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const tenantId = rows[0]?.tenantId;
  if (tenantId === null || tenantId === undefined) {
    throw new Error(`the fixture account ${userId} has no tenant`);
  }
  return tenantId;
}
