import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { recordUsage } from "../src/lib/tenancy/usage";
import { registerTenantDomain } from "../src/lib/tenancy/domains";
import {
  createTenant,
  suspendTenant,
  validateTenantDraft,
} from "../src/lib/tenants";
import { setRole } from "../src/lib/users";
import {
  PLATFORM_USAGE_WINDOW_MS,
  formatSeconds,
  groupPlatformAccounts,
  platformAccounts,
  platformTenants,
} from "../src/lib/platform";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function tenant(slug: string, speechAllowanceSeconds?: number) {
  const validation = validateTenantDraft({ name: slug, slug, speechAllowanceSeconds });
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  const created = await createTenant(validation.draft);
  if (!created.ok) throw new Error(`could not create ${slug}`);
  return created.tenant;
}

async function account(email: string, tenantId?: string) {
  const result = await registerAccount(email, "a good password", tenantId);
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

describe("the platform tenants view", () => {
  it("shows status, hosts, accounts and usage for every tenant", async () => {
    const first = await tenant("first", 10);
    const second = await tenant("second");
    await suspendTenant(second.id);

    await registerTenantDomain(first.id, { domain: "console.first.example", kind: "console" });
    await registerTenantDomain(first.id, { domain: "gw.first.example", kind: "gateway" });
    await account("ann@example.com", first.id);
    await account("bob@example.com", first.id);
    await account("cid@example.com", second.id);

    await recordUsage({
      tenantId: first.id,
      kind: "speech",
      source: "platform",
      seconds: 15,
    });
    await recordUsage({
      tenantId: first.id,
      kind: "speech",
      source: "reseller",
      seconds: 5,
    });

    const views = await platformTenants(new Date());
    assert.equal(views.length, 2);

    const firstView = views.find((view) => view.tenant.slug === "first")!;
    assert.equal(firstView.tenant.status, "active");
    assert.equal(firstView.domains.length, 2);
    assert.equal(firstView.accounts, 2);
    assert.equal(firstView.usage.platformSeconds, 15);
    assert.equal(firstView.usage.resellerSeconds, 5);
    assert.equal(firstView.usage.billableSeconds, 5);

    const secondView = views.find((view) => view.tenant.slug === "second")!;
    assert.equal(secondView.tenant.status, "suspended");
    assert.equal(secondView.domains.length, 0);
    assert.equal(secondView.accounts, 1);
  });

  it("names the window it reports", () => {
    assert.equal(PLATFORM_USAGE_WINDOW_MS, 30 * 24 * 60 * 60 * 1000);
  });
});

describe("the platform roles view", () => {
  it("groups accounts by tenant, with platform admins first", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const ann = await account("ann@example.com", first.id);
    const bob = await account("bob@example.com", second.id);
    const root = await account("root@example.com");

    await setRole("ann@example.com", "tenant_admin");
    await setRole("root@example.com", "platform_admin");

    const accounts = await platformAccounts();
    assert.equal(accounts.find((entry) => entry.id === ann.id)?.tenantName, "first");
    assert.equal(accounts.find((entry) => entry.id === bob.id)?.tenantName, "second");
    assert.equal(accounts.find((entry) => entry.id === root.id)?.tenantName, null);

    const groups = groupPlatformAccounts(accounts);
    assert.equal(groups[0]!.tenantId, null);
    assert.equal(groups[0]!.tenantName, null);
    assert.deepEqual(
      groups.slice(1).map((group) => group.tenantName),
      ["first", "second"]
    );
    assert.deepEqual(
      groups
        .flatMap((group) => group.accounts)
        .map((entry) => entry.email)
        .sort(),
      ["ann@example.com", "bob@example.com", "root@example.com"]
    );
  });
});

describe("usage durations", () => {
  it("formats seconds, minutes and hours", () => {
    assert.equal(formatSeconds(59), "59 s");
    assert.equal(formatSeconds(60), "1 min");
    assert.equal(formatSeconds(3600), "1 h");
    assert.equal(formatSeconds(3660), "1 h 1 min");
  });
});
