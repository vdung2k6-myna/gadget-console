import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { backfillPilotTenant } from "../src/lib/tenancy/backfill";
import {
  agents,
  claims,
  devices,
  providerProfiles,
  runtimes,
  tenants,
  turns,
  users,
} from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function seed() {
  const [admin] = await getDb()
    .insert(users)
    .values({ email: "admin@example.com", passwordHash: "x", role: "admin" })
    .returning();
  const [person] = await getDb()
    .insert(users)
    .values({ email: "person@example.com", passwordHash: "x", role: "user" })
    .returning();
  const [runtime] = await getDb()
    .insert(runtimes)
    .values({
      name: "interview",
      baseUrl: "http://127.0.0.1:4000",
      token: "runtime-token",
      engines: [],
      languages: [],
    })
    .returning();
  const [agent] = await getDb()
    .insert(agents)
    .values({
      userId: person.id,
      runtimeId: runtime.id,
      name: "Agent",
      systemPrompt: "hi",
      language: "vi",
    })
    .returning();
  const [device] = await getDb()
    .insert(devices)
    .values({ deviceId: "device-1", userId: person.id, agentId: agent.id, secret: "secret" })
    .returning();
  await getDb().insert(claims).values({
    deviceId: "device-1",
    code: "123456",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await getDb().insert(turns).values({
    deviceId: device.id,
    userText: "xin chào",
    assistantText: "chào",
    language: "vi",
    startedAt: new Date(),
    endedAt: new Date(),
  });
  await getDb().insert(providerProfiles).values({
    userId: person.id,
    kind: "llm",
    name: "Own",
    baseUrl: "https://example.com/v1",
    model: "m",
    builtin: false,
  });
  await getDb().insert(providerProfiles).values({
    userId: null,
    kind: "llm",
    name: "Built-in",
    baseUrl: "https://example.com/v1",
    model: "m",
    builtin: true,
    isDefault: true,
  });
  return { admin, person, runtime, agent, device };
}

describe("pilot tenancy backfill", () => {
  it("reports counts and writes nothing on a dry run", async () => {
    const { person } = await seed();

    const report = await backfillPilotTenant(
      {
        tenantName: "Pilot",
        tenantSlug: "pilot",
        platformAdminEmails: ["admin@example.com"],
      },
      { dryRun: true }
    );

    assert.equal(report.tenantCreated, true);
    assert.equal(report.tenantId, null);
    assert.equal((await getDb().select().from(tenants)).length, 0);

    const personRow = (
      await getDb().select().from(users).where(eq(users.id, person.id))
    )[0];
    assert.equal(personRow?.tenantId, null);

    const devices = report.tables.find((table) => table.table === "devices");
    assert.equal(devices?.assigned, 1);

    const userTable = report.tables.find((table) => table.table === "users");
    assert.equal(userTable?.assigned, 1);
  });

  it("assigns the pilot tenant and maps the roles", async () => {
    const { admin, person, runtime, agent, device } = await seed();

    const report = await backfillPilotTenant({
      tenantName: "Pilot",
      tenantSlug: "pilot",
      platformAdminEmails: ["admin@example.com"],
    });

    assert.equal(report.tenantCreated, true);
    const [tenant] = await getDb().select().from(tenants);
    assert.equal(tenant?.slug, "pilot");

    const adminRow = (
      await getDb().select().from(users).where(eq(users.id, admin.id))
    )[0];
    assert.equal(adminRow?.tenantId, null);
    assert.equal(adminRow?.role, "platform_admin");

    const personRow = (
      await getDb().select().from(users).where(eq(users.id, person.id))
    )[0];
    assert.equal(personRow?.tenantId, tenant?.id);
    assert.equal(personRow?.role, "user");

    const runtimeRow = (
      await getDb().select().from(runtimes).where(eq(runtimes.id, runtime.id))
    )[0];
    assert.equal(runtimeRow?.tenantId, tenant?.id);

    const agentRow = (
      await getDb().select().from(agents).where(eq(agents.id, agent.id))
    )[0];
    assert.equal(agentRow?.tenantId, tenant?.id);

    const deviceRow = (
      await getDb().select().from(devices).where(eq(devices.id, device.id))
    )[0];
    assert.equal(deviceRow?.tenantId, tenant?.id);

    const turnRow = (await getDb().select().from(turns))[0];
    assert.equal(turnRow?.tenantId, tenant?.id);

    const claimRow = (await getDb().select().from(claims))[0];
    assert.equal(claimRow?.tenantId, tenant?.id);

    const profiles = await getDb().select().from(providerProfiles);
    assert.equal(profiles.find((profile) => profile.name === "Own")?.tenantId, tenant?.id);
    assert.equal(profiles.find((profile) => profile.name === "Built-in")?.tenantId, null);
  });
});
