import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { tenantDomains, tenants } from "../src/lib/db/schema";
import { isUserRole, USER_ROLES } from "../src/lib/auth/roles";
import { providerScope } from "../src/lib/provider-profiles";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function createTenant(slug: string) {
  const rows = await getDb()
    .insert(tenants)
    .values({ name: slug, slug })
    .returning();
  return rows[0]!;
}

/** Drizzle wraps the driver error; the unique violation is in the cause. */
async function assertUniqueViolation(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    const text = `${String(error)} ${cause?.message ?? ""}`;
    return cause?.code === "23505" || /unique|duplicate/i.test(text);
  });
}

describe("tenants", () => {
  it("stores a tenant and its domains", async () => {
    const tenant = await createTenant("acme");
    await getDb().insert(tenantDomains).values({
      tenantId: tenant.id,
      domain: "console.acme.example",
      kind: "console",
    });

    const rows = await getDb()
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenant.id));

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.domain, "console.acme.example");
    assert.equal(rows[0]?.kind, "console");
  });

  it("refuses a host that already belongs to another tenant", async () => {
    const first = await createTenant("first");
    const second = await createTenant("second");

    await getDb().insert(tenantDomains).values({
      tenantId: first.id,
      domain: "console.example.com",
      kind: "console",
    });

    await assertUniqueViolation(
      getDb().insert(tenantDomains).values({
        tenantId: second.id,
        domain: "console.example.com",
        kind: "console",
      })
    );
  });

  it("allows one console host and one gateway host per tenant", async () => {
    const tenant = await createTenant("acme");
    await getDb().insert(tenantDomains).values([
      { tenantId: tenant.id, domain: "console.acme.example", kind: "console" },
      { tenantId: tenant.id, domain: "gw.acme.example", kind: "gateway" },
    ]);

    await assertUniqueViolation(
      getDb().insert(tenantDomains).values({
        tenantId: tenant.id,
        domain: "console2.acme.example",
        kind: "console",
      })
    );
  });
});

describe("tenancy roles and provider scopes", () => {
  it("knows the four tenant roles", () => {
    for (const role of USER_ROLES) assert.equal(isUserRole(role), true);
    assert.equal(isUserRole("admin"), false);
    assert.equal(isUserRole("owner"), false);
  });

  it("classifies platform, tenant and account profiles", () => {
    assert.equal(providerScope({ builtin: true, tenantId: null }), "platform");
    assert.equal(providerScope({ builtin: true, tenantId: "tenant-1" }), "tenant");
    assert.equal(providerScope({ builtin: false, tenantId: "tenant-1" }), "account");
  });
});
