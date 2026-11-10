import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { resolveDevice } from "../src/lib/bridge/registry";
import { devices, tenants, turns, usageEvents } from "../src/lib/db/schema";
import {
  checkConcurrencyQuota,
  checkProviderSpendQuota,
  checkQuota,
  checkSpeechQuota,
  enforceDeviceQuota,
  enforceTurnQuota,
  quotaRefusalMessage,
  speechSecondsUsed,
  type TenantQuotaSource,
} from "../src/lib/tenancy/quotas";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

function source(overrides: Partial<TenantQuotaSource> = {}): TenantQuotaSource {
  return {
    id: "tenant-1",
    name: "First",
    slug: "first",
    quotas: {
      devices: 2,
      turns: 1,
      concurrency: 1,
      speechSeconds: 10,
      providerSpend: 5,
    },
    ...overrides,
  };
}

describe("quota checks", () => {
  it("allows under the limit and refuses over it with the tenant named", () => {
    assert.equal(checkQuota(source(), "devices", 1, 1), null);

    const refusal = checkQuota(source(), "devices", 2, 1);
    assert.notEqual(refusal, null);
    assert.equal(refusal?.kind, "devices");
    assert.equal(refusal?.limit, 2);
    assert.equal(refusal?.tenant, "First");
    assert.match(quotaRefusalMessage(refusal!), /First/);
    assert.match(quotaRefusalMessage(refusal!), /devices/);
    assert.match(quotaRefusalMessage(refusal!), /2/);
  });

  it("treats an absent quota as no bound", () => {
    assert.equal(checkQuota(source({ quotas: null }), "devices", 999, 1), null);
    assert.equal(checkQuota(source({ quotas: {} }), "turns", 999, 1), null);
  });

  it("checks speech, provider spend and concurrency", () => {
    assert.equal(checkSpeechQuota(source(), 9), null);
    assert.equal(checkSpeechQuota(source(), 10)?.kind, "speechSeconds");
    assert.equal(checkProviderSpendQuota(source(), 4), null);
    assert.equal(checkProviderSpendQuota(source(), 5)?.kind, "providerSpend");
    assert.equal(checkConcurrencyQuota(source(), 0), null);
    assert.equal(checkConcurrencyQuota(source(), 1)?.kind, "concurrency");
  });
});

describe("quota enforcement", () => {
  it("counts a tenant's devices and turns", async () => {
    const [tenant] = await getDb()
      .insert(tenants)
      .values({ name: "First", slug: "first", quotas: { devices: 1, turns: 1 } })
      .returning();

    assert.equal(await enforceDeviceQuota(tenant), null);
    await getDb()
      .insert(devices)
      .values({ deviceId: "firstdevice", secret: "s".repeat(32), tenantId: tenant.id });
    assert.equal((await enforceDeviceQuota(tenant))?.kind, "devices");

    const [device] = await getDb()
      .select()
      .from(devices)
      .where(eq(devices.deviceId, "firstdevice"));
    await getDb().insert(turns).values({
      deviceId: device!.id,
      tenantId: tenant.id,
      userText: "u",
      assistantText: "a",
      language: "vi",
      startedAt: new Date(),
      endedAt: new Date(),
      createdAt: new Date(),
    });
    assert.equal((await enforceTurnQuota(tenant))?.kind, "turns");
  });

  it("sums a tenant's speech seconds", async () => {
    const [tenant] = await getDb()
      .insert(tenants)
      .values({ name: "First", slug: "first" })
      .returning();
    const now = new Date();
    await getDb().insert(usageEvents).values([
      { tenantId: tenant.id, kind: "speech", seconds: 2, createdAt: now },
      { tenantId: tenant.id, kind: "speech", seconds: 3, createdAt: now },
    ]);

    assert.equal(await speechSecondsUsed(tenant.id, new Date(now.getTime() - 3_600_000)), 5);
  });

  it("refuses a new device when the tenant's device quota is reached", async () => {
    const [tenant] = await getDb()
      .insert(tenants)
      .values({ name: "First", slug: "first", quotas: { devices: 0 } })
      .returning();

    const resolution = await resolveDevice("quotadevice", tenant.id);
    assert.equal(resolution.kind, "quota-exceeded");
    if (resolution.kind === "quota-exceeded") {
      assert.equal(resolution.refusal.kind, "devices");
      assert.equal(resolution.refusal.tenant, "First");
    }
    assert.equal((await getDb().select().from(devices)).length, 0);
  });

  it("refuses an owned device's connection when the turn quota is reached", async () => {
    const [tenant] = await getDb()
      .insert(tenants)
      .values({ name: "First", slug: "first", quotas: { turns: 0 } })
      .returning();
    const registered = await registerAccount("ann@example.com", "a good password", tenant.id);
    assert.equal(registered.ok, true);
    if (!registered.ok) return;

    await getDb().insert(devices).values({
      deviceId: "owneddevice",
      userId: registered.user.id,
      secret: "s".repeat(32),
      tenantId: tenant.id,
    });

    const resolution = await resolveDevice("owneddevice", tenant.id);
    assert.equal(resolution.kind, "quota-exceeded");
    if (resolution.kind === "quota-exceeded") {
      assert.equal(resolution.refusal.kind, "turns");
    }
  });
});
