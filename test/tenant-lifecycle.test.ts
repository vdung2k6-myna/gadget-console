import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { createSession } from "../src/lib/auth/session";
import { createRuntime } from "../src/lib/runtimes";
import { findTenant, suspendTenant } from "../src/lib/tenants";
import { deleteTenant, exportTenant } from "../src/lib/tenancy/lifecycle";
import {
  agents,
  auditEvents,
  calibrationAudit,
  calibrationDefault,
  claims,
  conversations,
  deviceCalibration,
  devices,
  firmwareReleases,
  providerAdapters,
  providerProfiles,
  tenantDomains,
  tenants,
  turns,
  usageEvents,
} from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function seedTenant(slug: string) {
  const [tenant] = await getDb()
    .insert(tenants)
    .values({ name: slug, slug })
    .returning();
  const account = await registerAccount(`${slug}@example.com`, "a good password", tenant!.id);
  if (!account.ok) throw new Error("account failed");
  return { tenant: tenant!, account: account.user };
}

async function seedRows(tenantId: string, userId: string, label: string) {
  const runtime = await createRuntime({
    name: `runtime-${label}`,
    baseUrl: "http://127.0.0.1:4000",
    token: "runtime-token",
    engines: ["engine-a"],
    languages: ["vietnamese"],
  });

  await getDb().insert(tenantDomains).values({
    tenantId,
    domain: `console.${label}.example`,
    kind: "console",
  });
  const [device] = await getDb()
    .insert(devices)
    .values({
      tenantId,
      deviceId: `${label}-device`,
      userId,
      secret: `secret-${label}`,
      name: label,
    })
    .returning();
  await getDb().insert(agents).values({
    tenantId,
    userId,
    runtimeId: runtime.id,
    name: `${label} persona`,
    systemPrompt: "be helpful",
    language: "vietnamese",
  });
  await getDb().insert(claims).values({
    tenantId,
    deviceId: `${label}-device`,
    code: `code-${label}`,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await getDb().insert(conversations).values({
    tenantId,
    deviceId: device!.id,
    startedAt: new Date(),
  });
  await getDb().insert(deviceCalibration).values({
    deviceId: device!.id,
    tenantId,
    threshold: 0.5,
    minFrames: 3,
    appliedBy: `operator:${label}@example.com`,
  });
  await getDb().insert(calibrationDefault).values({
    id: `default-${label}`,
    tenantId,
    threshold: 0.5,
    minFrames: 3,
  });
  await getDb().insert(calibrationAudit).values({
    tenantId,
    deviceId: device!.id,
    threshold: 0.5,
    minFrames: 3,
    actor: `operator:${label}@example.com`,
  });
  await getDb().insert(providerAdapters).values({
    tenantId,
    name: `${label} adapter`,
    endpoint: "https://adapter.example/v1",
    kinds: ["llm"],
    status: "verified",
    health: "ok",
  });
  await getDb().insert(auditEvents).values({
    tenantId,
    actorEmail: `${label}@example.com`,
    action: "test.event",
    targetType: "tenant",
    targetId: tenantId,
  });
  await createSession(userId);
  await getDb().insert(firmwareReleases).values({
    tenantId,
    boardType: "esp-box-3",
    version: label,
    sizeBytes: 1,
    sha256: "a".repeat(64),
  });
  await getDb().insert(providerProfiles).values({
    tenantId,
    userId,
    kind: "llm",
    name: `${label} model`,
    baseUrl: "https://llm.example/v1",
    model: "model",
    encryptedKey: `cipher-${label}`,
  });
  await getDb().insert(turns).values({
    tenantId,
    deviceId: device!.id,
    userText: `hello ${label}`,
    assistantText: `hi ${label}`,
    language: "en",
    startedAt: new Date(),
    endedAt: new Date(),
  });
  await getDb().insert(usageEvents).values({
    tenantId,
    kind: "speech",
    source: "platform",
    seconds: 3,
  });
}

describe("tenant export", () => {
  it("returns the tenant's rows without secrets or another tenant's data", async () => {
    const first = await seedTenant("first");
    const second = await seedTenant("second");
    await seedRows(first.tenant.id, first.account.id, "first");
    await seedRows(second.tenant.id, second.account.id, "second");

    const exported = await exportTenant(first.tenant.id);
    assert.ok(exported !== undefined);
    if (exported === undefined) return;

    assert.equal(exported.tenant.slug, "first");
    assert.deepEqual(
      exported.domains.map((row) => row.domain),
      ["console.first.example"]
    );
    assert.equal(exported.users.length, 1);
    assert.equal(exported.devices.length, 1);
    assert.equal(exported.agents.length, 1);
    assert.equal(exported.claims.length, 1);
    assert.equal(exported.firmware.length, 1);
    assert.equal(exported.profiles.length, 1);
    assert.equal(exported.turns.length, 1);
    assert.equal(exported.usage.length, 1);

    assert.deepEqual(exported.users.map((row) => row.email), ["first@example.com"]);
    assert.ok(exported.devices.every((row) => row.tenantId === first.tenant.id));
    assert.ok(exported.agents.every((row) => row.tenantId === first.tenant.id));
    assert.ok(exported.turns.every((row) => row.tenantId === first.tenant.id));
    assert.ok(exported.usage.every((row) => row.tenantId === first.tenant.id));
    assert.ok(exported.domains.every((row) => row.tenantId === first.tenant.id));

    const text = JSON.stringify(exported);
    assert.ok(!text.includes("passwordHash"));
    assert.ok(!text.includes("secret-first"));
    assert.ok(!text.includes("cipher-first"));
    assert.ok(!text.includes("code-first"));
    assert.ok(!text.includes("second@example.com"));
    assert.ok(!text.includes("hello second"));
  });

  it("answers undefined for a tenant that does not exist", async () => {
    assert.equal(await exportTenant("00000000-0000-4000-8000-000000000000"), undefined);
  });
});

describe("tenant deletion", () => {
  it("removes only that tenant's rows and leaves a platform audit row", async () => {
    const first = await seedTenant("first");
    const second = await seedTenant("second");
    await seedRows(first.tenant.id, first.account.id, "first");
    await seedRows(second.tenant.id, second.account.id, "second");
    assert.equal((await suspendTenant(first.tenant.id))?.status, "suspended");

    const actorAccount = await registerAccount("root@example.com", "a good password");
    if (!actorAccount.ok) throw new Error("root account failed");
    const actor = { id: actorAccount.user.id, email: "root@example.com" };
    assert.equal(await deleteTenant(first.tenant.id, actor), "deleted");
    assert.equal(await findTenant(first.tenant.id), undefined);
    assert.ok((await findTenant(second.tenant.id)) !== undefined);

    for (const [table, column] of [
      [devices, devices.tenantId],
      [agents, agents.tenantId],
      [claims, claims.tenantId],
      [firmwareReleases, firmwareReleases.tenantId],
      [providerProfiles, providerProfiles.tenantId],
      [turns, turns.tenantId],
      [usageEvents, usageEvents.tenantId],
      [tenantDomains, tenantDomains.tenantId],
    ] as const) {
      const remaining = await getDb()
        .select()
        .from(table)
        .where(eq(column, first.tenant.id));
      assert.equal(remaining.length, 0, `${table} rows removed`);
      const other = await getDb()
        .select()
        .from(table)
        .where(eq(column, second.tenant.id));
      assert.equal(other.length, 1, `${table} rows for the other tenant stay`);
    }


    // Every table that carries tenant_id, not only the seeded ones.
    const tableResult = await getDb().execute(
      sql`select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'tenant_id'`
    );
    const scopedTables = (
      tableResult as unknown as { rows: Array<{ table_name: string }> }
    ).rows;
    assert.ok(scopedTables.length >= 10, "the scan found the tenant-scoped tables");
    for (const { table_name } of scopedTables) {
      const result = await getDb().execute(
        sql`select count(*)::int as n from ${sql.identifier(table_name)}
            where tenant_id = ${first.tenant.id}`
      );
      const rows = (result as unknown as { rows: Array<{ n: number }> }).rows;
      assert.equal(Number(rows[0]?.n ?? 0), 0, `${table_name} keeps no row for the deleted tenant`);
    }

    // Sessions have no tenant_id; they follow the account.
    const sessions = await getDb().execute(
      sql`select count(*)::int as n from sessions where user_id = ${first.account.id}`
    );
    assert.equal(
      Number((sessions as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0),
      0,
      "the deleted tenant's sessions are gone"
    );

    const audit = await getDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "tenant.delete"));
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.tenantId, null);
    assert.equal(audit[0]!.targetId, first.tenant.id);
    assert.equal(audit[0]!.metadata?.slug, "first");
  });

  it("refuses a tenant that is already gone", async () => {
    assert.equal(
      await deleteTenant("00000000-0000-4000-8000-000000000000", {
        id: "root",
        email: "root@example.com",
      }),
      "not-found"
    );
  });
});
