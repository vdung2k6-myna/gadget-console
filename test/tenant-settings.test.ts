import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { checkQuota } from "../src/lib/tenancy/quotas";
import { tenants } from "../src/lib/db/schema";
import {
  findTenant,
  updateTenantAdminSettings,
  updateTenantSettings,
  validateTenantAdminSettings,
  validateTenantSettings,
} from "../src/lib/tenants";
import { tenantBranding } from "../src/lib/tenancy/branding";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function tenant() {
  const rows = await getDb()
    .insert(tenants)
    .values({
      name: "First",
      slug: "first",
      locale: "vi",
      retentionDays: null,
      plan: "starter",
      quotas: { devices: 5, turns: 100 },
      branding: null,
    })
    .returning();
  return rows[0]!;
}

describe("tenant settings validation", () => {
  it("accepts the platform's full settings", () => {
    const result = validateTenantSettings({
      locale: "en",
      retentionDays: 30,
      speechAllowanceSeconds: 600,
      plan: "growth",
      quotas: { devices: 10, turns: 500 },
      branding: { primaryColor: "#112233", supportEmail: "help@example.com" },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.settings.locale, "en");
    assert.equal(result.settings.retentionDays, 30);
    assert.equal(result.settings.quotas?.devices, 10);
    assert.equal(result.settings.branding?.primaryColor, "#112233");
  });

  it("refuses invalid values and accepts the tenant admin's smaller form", () => {
    assert.equal(validateTenantSettings({ locale: "fr" }).ok, false);
    assert.equal(validateTenantSettings({ retentionDays: -1 }).ok, false);
    assert.equal(validateTenantSettings({ quotas: { devices: -1 } }).ok, false);
    assert.equal(
      validateTenantSettings({ branding: { primaryColor: "red" } }).ok,
      false
    );

    const admin = validateTenantAdminSettings({
      locale: "en",
      retentionDays: 14,
      branding: { supportEmail: "help@example.com" },
    });
    assert.equal(admin.ok, true);
    if (!admin.ok) return;
    assert.equal(admin.settings.retentionDays, 14);
    assert.equal(admin.settings.branding?.supportEmail, "help@example.com");
  });
});

describe("tenant settings updates", () => {
  it("applies branding, locale and retention without touching the platform's quotas", async () => {
    const first = await tenant();
    const updated = await updateTenantAdminSettings(first.id, {
      locale: "en",
      retentionDays: 14,
      branding: {
        logoUrl: "https://cdn.example/logo.svg",
        primaryColor: "#112233",
        accentColor: "#445566",
        supportEmail: "help@example.com",
        supportUrl: null,
        supportPhone: null,
      },
    });

    assert.equal(updated?.locale, "en");
    assert.equal(updated?.retentionDays, 14);
    assert.equal(tenantBranding(updated?.branding).logoUrl, "https://cdn.example/logo.svg");
    assert.deepEqual(updated?.quotas, { devices: 5, turns: 100 });
    assert.equal(updated?.plan, "starter");
  });

  it("applies the platform's quotas and allowance", async () => {
    const first = await tenant();
    const updated = await updateTenantSettings(first.id, {
      locale: "vi",
      retentionDays: 7,
      speechAllowanceSeconds: 60,
      plan: "growth",
      quotas: { devices: 2 },
      branding: null,
    });

    assert.equal(updated?.plan, "growth");
    assert.equal(updated?.speechAllowanceSeconds, 60);
    assert.deepEqual(updated?.quotas, { devices: 2 });

    const stored = await findTenant(first.id);
    assert.ok(stored !== undefined);
    assert.equal(
      checkQuota(stored, "devices", 2, 1)?.kind,
      "devices",
      "the new quota refuses one more device"
    );
  });
});
