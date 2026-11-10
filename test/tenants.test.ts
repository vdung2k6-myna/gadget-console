import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { changeRoleAsAdmin, listAccounts } from "../src/lib/users";
import {
  createTenant,
  listTenants,
  resumeTenant,
  suspendTenant,
  validateTenantDraft,
} from "../src/lib/tenants";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function tenant(slug: string) {
  const validation = validateTenantDraft({ name: slug, slug });
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  const created = await createTenant(validation.draft);
  if (!created.ok) throw new Error(`could not create ${slug}`);
  return created.tenant;
}

async function account(email: string, tenantId: string) {
  const result = await registerAccount(email, "a good password", tenantId);
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

describe("tenant creation", () => {
  it("creates and lists a tenant; refuses a duplicate slug", async () => {
    const created = await tenant("acme");
    assert.equal(created.slug, "acme");

    const duplicate = validateTenantDraft({ name: "Acme again", slug: "acme" });
    assert.equal(duplicate.ok, true);
    if (!duplicate.ok) return;
    assert.deepEqual(await createTenant(duplicate.draft), { ok: false, reason: "taken" });
    assert.equal((await listTenants()).length, 1);
  });

  it("refuses an invalid draft", () => {
    assert.equal(validateTenantDraft({ name: "", slug: "Bad Slug" }).ok, false);
    assert.equal(validateTenantDraft({ name: "Acme", slug: "acme", locale: "fr" }).ok, false);
  });
});

describe("tenant suspension", () => {
  it("suspends and resumes a tenant", async () => {
    const acme = await tenant("acme");
    assert.equal((await suspendTenant(acme.id))?.status, "suspended");
    assert.equal((await resumeTenant(acme.id))?.status, "active");
  });
});

describe("cross-tenant role management", () => {
  it("lets a platform admin change a role in any tenant", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const ann = await account("ann@example.com", first.id);
    const bob = await account("bob@example.com", second.id);
    const admin = { email: "root@example.com", role: "platform_admin", tenantId: null };

    assert.deepEqual(await changeRoleAsAdmin(admin, ann.id, "tenant_admin"), { ok: true });
    assert.deepEqual(await changeRoleAsAdmin(admin, bob.id, "support"), { ok: true });

    assert.equal(
      (await listAccounts(first.id)).find((entry) => entry.email === "ann@example.com")?.role,
      "tenant_admin"
    );
    assert.equal(
      (await listAccounts(second.id)).find((entry) => entry.email === "bob@example.com")?.role,
      "support"
    );
  });
});
