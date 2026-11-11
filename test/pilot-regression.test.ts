import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { backfillPilotTenant } from "../src/lib/tenancy/backfill";
import { resolveDevice } from "../src/lib/bridge/registry";
import { listAgents, listDevices, listTurns } from "../src/lib/tenancy/repository";
import { findTenantByConsoleHost, findTenantByGatewayHost } from "../src/lib/tenancy/resolve";
import { listProviderProfiles } from "../src/lib/provider-profiles";
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

const DEVICE_ID = "b81f3f4a9b01";

async function legacyDeployment() {
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
      engines: ["engine-a"],
      languages: ["vietnamese"],
    })
    .returning();
  const [agent] = await getDb()
    .insert(agents)
    .values({
      userId: person!.id,
      runtimeId: runtime!.id,
      name: "Pilot persona",
      systemPrompt: "be helpful",
      language: "vietnamese",
    })
    .returning();
  const [device] = await getDb()
    .insert(devices)
    .values({
      deviceId: DEVICE_ID,
      userId: person!.id,
      agentId: agent!.id,
      secret: "s".repeat(32),
    })
    .returning();
  await getDb().insert(claims).values({
    deviceId: DEVICE_ID,
    code: "123456",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await getDb().insert(turns).values({
    deviceId: device!.id,
    userText: "xin chào",
    assistantText: "chào",
    language: "vietnamese",
    startedAt: new Date(),
    endedAt: new Date(),
  });
  await getDb().insert(providerProfiles).values({
    userId: null,
    kind: "llm",
    name: "Pilot built-in",
    baseUrl: "https://example.com/v1",
    model: "m",
    builtin: true,
    isDefault: true,
  });

  return { admin: admin!, person: person!, runtime: runtime!, agent: agent!, device: device! };
}

describe("the pilot tenant after the migration", () => {
  it("resolves its hosts and serves the same device, agent, turn and profile", async () => {
    const legacy = await legacyDeployment();

    const report = await backfillPilotTenant({
      tenantName: "Pilot",
      tenantSlug: "pilot",
      platformAdminEmails: ["admin@example.com"],
      consoleDomain: "console.pilot.example",
      gatewayDomain: "gw.pilot.example",
    });
    assert.ok(report.tenantId !== null);
    const tenantId = report.tenantId!;

    const [tenant] = await getDb().select().from(tenants);
    assert.equal(tenant?.slug, "pilot");
    assert.equal((await findTenantByConsoleHost("console.pilot.example"))?.id, tenantId);
    assert.equal((await findTenantByGatewayHost("gw.pilot.example"))?.id, tenantId);

    const admin = (await getDb().select().from(users).where(eq(users.id, legacy.admin.id)))[0];
    assert.equal(admin?.role, "platform_admin");
    assert.equal(admin?.tenantId, null);

    const person = (await getDb().select().from(users).where(eq(users.id, legacy.person.id)))[0];
    assert.equal(person?.tenantId, tenantId);
    assert.equal(person?.role, "user");

    const context = { tenantId };
    assert.deepEqual((await listDevices(context)).map((row) => row.id), [legacy.device.id]);
    assert.deepEqual((await listAgents(context)).map((row) => row.id), [legacy.agent.id]);
    assert.equal((await listTurns(context)).length, 1);
    assert.ok(
      (await listProviderProfiles(legacy.person.id)).some(
        (profile) => profile.name === "Pilot built-in"
      ),
      "the platform built-in is still selectable"
    );

    const resolved = await resolveDevice(DEVICE_ID, tenantId);
    assert.equal(resolved.kind, "owned");
    if (resolved.kind !== "owned") return;
    assert.equal((resolved.body.agent as { name?: string } | null)?.name, "Pilot persona");
    assert.equal((resolved.body.turns as unknown[]).length, 1);
  });

  it("is stable when the backfill runs a second time", async () => {
    await legacyDeployment();
    const first = await backfillPilotTenant({
      tenantName: "Pilot",
      tenantSlug: "pilot",
      platformAdminEmails: ["admin@example.com"],
    });
    const second = await backfillPilotTenant({
      tenantName: "Pilot",
      tenantSlug: "pilot",
      platformAdminEmails: ["admin@example.com"],
    });

    assert.equal(first.tenantId, second.tenantId);
    assert.equal(second.tenantCreated, false);
    assert.equal((await getDb().select().from(tenants)).length, 1);
    assert.equal(
      (await getDb().select().from(devices)).every((row) => row.tenantId === first.tenantId),
      true
    );
  });
});
