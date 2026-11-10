import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { pruneAll } from "../src/lib/retention";
import { devices, tenants, turns } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

const now = new Date("2026-10-25T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

async function seedTenant(slug: string, retentionDays: number | null) {
  const [tenant] = await getDb()
    .insert(tenants)
    .values({ name: slug, slug, retentionDays })
    .returning();
  const [device] = await getDb()
    .insert(devices)
    .values({
      deviceId: `${slug}device`,
      secret: "s".repeat(32),
      tenantId: tenant.id,
      createdAt: now,
    })
    .returning();
  return { tenant, device };
}

async function seedTurn(deviceId: string, tenantId: string, daysOld: number) {
  await getDb().insert(turns).values({
    deviceId,
    tenantId,
    userText: "u",
    assistantText: "a",
    language: "vi",
    startedAt: ago(daysOld),
    endedAt: ago(daysOld),
    createdAt: ago(daysOld),
  });
}

describe("per-tenant retention", () => {
  it("removes each tenant's turns on its own value", async () => {
    const first = await seedTenant("first", 1);
    const second = await seedTenant("second", 90);
    await seedTurn(first.device.id, first.tenant.id, 2);
    await seedTurn(first.device.id, first.tenant.id, 40);
    await seedTurn(second.device.id, second.tenant.id, 2);
    await seedTurn(second.device.id, second.tenant.id, 40);

    const report = await pruneAll(now);
    assert.equal(report.turns, 2, "the first tenant's two old turns are removed");

    const remaining = (await getDb().select().from(turns))
      .map((row) => row.tenantId)
      .sort();
    assert.deepEqual(remaining, [second.tenant.id, second.tenant.id]);
  });

  it("uses the deployment retention for a tenant that states none", async () => {
    const previous = process.env.RETENTION_DAYS;
    process.env.RETENTION_DAYS = "30";
    try {
      const inherited = await seedTenant("inherited", null);
      await seedTurn(inherited.device.id, inherited.tenant.id, 45);
      await seedTurn(inherited.device.id, inherited.tenant.id, 10);

      const report = await pruneAll(now);
      assert.equal(report.turns, 1);
      assert.equal((await getDb().select().from(turns)).length, 1);
    } finally {
      if (previous === undefined) delete process.env.RETENTION_DAYS;
      else process.env.RETENTION_DAYS = previous;
    }
  });
});
