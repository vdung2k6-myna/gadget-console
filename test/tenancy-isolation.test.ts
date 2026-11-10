import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import {
  agents,
  claims,
  devices,
  firmwareReleases,
  providerProfiles,
  runtimes,
  tenants,
  turns,
  usageEvents,
  users,
} from "../src/lib/db/schema";
import {
  asTenantContext,
  findAgent,
  findClaimByDeviceId,
  findDeviceByDeviceId,
  findDeviceRow,
  findProviderProfile,
  listAgents,
  listBuiltInProfiles,
  listClaims,
  listDevices,
  listFirmware,
  listTurns,
  listUsage,
  type TenantContext,
} from "../src/lib/tenancy/repository";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function seedTenant(slug: string) {
  const [tenant] = await getDb()
    .insert(tenants)
    .values({ name: slug, slug })
    .returning();
  const [user] = await getDb()
    .insert(users)
    .values({ email: `${slug}@example.com`, passwordHash: "x", tenantId: tenant.id })
    .returning();
  const [runtime] = await getDb()
    .insert(runtimes)
    .values({
      name: slug,
      baseUrl: "http://127.0.0.1:4000",
      token: `token-${slug}`,
      engines: [],
      languages: [],
      tenantId: tenant.id,
    })
    .returning();
  const [agent] = await getDb()
    .insert(agents)
    .values({
      userId: user.id,
      runtimeId: runtime.id,
      name: slug,
      systemPrompt: "hi",
      language: "vi",
      tenantId: tenant.id,
    })
    .returning();
  const [device] = await getDb()
    .insert(devices)
    .values({
      deviceId: `${slug}device`,
      userId: user.id,
      agentId: agent.id,
      secret: "s".repeat(32),
      tenantId: tenant.id,
    })
    .returning();
  await getDb().insert(claims).values({
    deviceId: `${slug}device`,
    code: `${slug}code`,
    expiresAt: new Date(Date.now() + 60_000),
    tenantId: tenant.id,
  });
  const [profile] = await getDb()
    .insert(providerProfiles)
    .values({
      tenantId: tenant.id,
      userId: null,
      builtin: true,
      kind: "tts",
      name: `${slug}-voice`,
      baseUrl: "https://example.com/v1",
      model: "m",
      voice: "v",
    })
    .returning();
  await getDb().insert(turns).values({
    deviceId: device.id,
    tenantId: tenant.id,
    userText: "u",
    assistantText: "a",
    language: "vi",
    startedAt: new Date(),
    endedAt: new Date(),
  });
  const [firmware] = await getDb()
    .insert(firmwareReleases)
    .values({
      tenantId: tenant.id,
      boardType: `${slug}-board`,
      version: "1.0.0",
      sizeBytes: 1,
      sha256: "x",
    })
    .returning();
  await getDb().insert(usageEvents).values({
    tenantId: tenant.id,
    kind: "speech",
    seconds: 1,
    bytes: 2,
  });

  return { tenant, user, runtime, agent, device, profile, firmware };
}

describe("tenant-scoped repository reads", () => {
  it("returns only the tenant's rows for every owned entity", async () => {
    const a = await seedTenant("a");
    const b = await seedTenant("b");
    const ctxA = { tenantId: a.tenant.id };
    const ctxB = { tenantId: b.tenant.id };

    assert.equal((await findDeviceByDeviceId(ctxA, "adevice"))?.id, a.device.id);
    assert.equal(await findDeviceByDeviceId(ctxA, "bdevice"), undefined);
    assert.equal(await findDeviceRow(ctxA, b.device.id), undefined);
    assert.deepEqual((await listDevices(ctxA)).map((row) => row.id), [a.device.id]);

    assert.equal((await findAgent(ctxA, a.agent.id))?.id, a.agent.id);
    assert.equal(await findAgent(ctxA, b.agent.id), undefined);
    assert.deepEqual((await listAgents(ctxA)).map((row) => row.id), [a.agent.id]);

    assert.equal((await findProviderProfile(ctxA, a.profile.id))?.id, a.profile.id);
    assert.equal(await findProviderProfile(ctxA, b.profile.id), undefined);

    assert.equal((await findClaimByDeviceId(ctxA, "adevice"))?.tenantId, a.tenant.id);
    assert.equal(await findClaimByDeviceId(ctxA, "bdevice"), undefined);
    assert.deepEqual((await listClaims(ctxA)).map((row) => row.tenantId), [a.tenant.id]);

    assert.deepEqual((await listTurns(ctxA)).map((row) => row.tenantId), [a.tenant.id]);
    assert.equal((await listTurns(ctxA, b.device.id)).length, 0);

    assert.deepEqual((await listFirmware(ctxA)).map((row) => row.id), [a.firmware.id]);
    assert.deepEqual((await listUsage(ctxA)).map((row) => row.tenantId), [a.tenant.id]);

    assert.equal((await findDeviceByDeviceId(ctxB, "bdevice"))?.id, b.device.id);
    assert.equal(await findDeviceByDeviceId(ctxB, "adevice"), undefined);
  });

  it("refuses every owned read without a tenant context", async () => {
    const missing = undefined as unknown as TenantContext;

    assert.throws(() => asTenantContext(undefined), /tenant context/);
    assert.throws(() => asTenantContext({ tenantId: "" }), /tenant context/);

    const calls = [
      () => findDeviceByDeviceId(missing, "x"),
      () => findDeviceRow(missing, "x"),
      () => listDevices(missing),
      () => findAgent(missing, "x"),
      () => listAgents(missing),
      () => findProviderProfile(missing, "x"),
      () => listBuiltInProfiles(missing),
      () => findClaimByDeviceId(missing, "x"),
      () => listClaims(missing),
      () => listTurns(missing),
      () => listFirmware(missing),
      () => listUsage(missing),
    ];
    for (const call of calls) await assert.rejects(call, /tenant context/);
  });

  it("shows platform built-ins to both tenants and tenant built-ins only to their own", async () => {
    const a = await seedTenant("a");
    const b = await seedTenant("b");
    await getDb().insert(providerProfiles).values({
      tenantId: null,
      userId: null,
      builtin: true,
      kind: "tts",
      name: "platform-voice",
      baseUrl: "https://example.com/v1",
      model: "m",
      voice: "v",
    });

    const namesA = (await listBuiltInProfiles({ tenantId: a.tenant.id }))
      .map((row) => row.name)
      .sort();
    const namesB = (await listBuiltInProfiles({ tenantId: b.tenant.id }))
      .map((row) => row.name)
      .sort();

    assert.deepEqual(namesA, ["a-voice", "platform-voice"]);
    assert.deepEqual(namesB, ["b-voice", "platform-voice"]);
  });
});
