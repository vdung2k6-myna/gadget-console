import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { adminDevice, adminTurns, listAllDevices } from "../src/lib/admin";
import { approveClaim, listPendingRequests } from "../src/lib/claims";
import { listFirmware, markFirmwareTarget, targetFor } from "../src/lib/firmware";
import {
  createProviderProfile,
  listTenantProviderProfiles,
} from "../src/lib/provider-profiles";
import { registerAccount } from "../src/lib/auth/accounts";
import {
  claims,
  devices,
  firmwareReleases,
  providerProfiles,
  tenants,
  turns,
} from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function tenant(slug: string) {
  const rows = await getDb()
    .insert(tenants)
    .values({ name: slug, slug })
    .returning();
  return rows[0]!;
}

async function account(email: string, tenantId: string) {
  const result = await registerAccount(email, "a good password", tenantId);
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

async function device(tenantId: string, userId: string, deviceId: string) {
  const rows = await getDb()
    .insert(devices)
    .values({ tenantId, deviceId, userId, secret: "s".repeat(32), name: "" })
    .returning();
  return rows[0]!;
}

async function firmware(tenantId: string, boardType: string, version: string) {
  const rows = await getDb()
    .insert(firmwareReleases)
    .values({
      tenantId,
      boardType,
      version,
      sizeBytes: 1,
      sha256: "a".repeat(64),
    })
    .returning();
  return rows[0]!;
}

describe("the tenant admin reads", () => {
  it("lists only the tenant's devices, turns and claims", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const ann = await account("ann@example.com", first.id);
    const bob = await account("bob@example.com", second.id);
    const mine = await device(first.id, ann.id, "adevice");
    const theirs = await device(second.id, bob.id, "bdevice");

    assert.deepEqual((await listAllDevices(first.id)).map((row) => row.id), [mine.id]);
    assert.equal(await adminDevice(theirs.id, first.id), undefined);
    assert.equal((await adminDevice(mine.id, first.id))?.id, mine.id);

    await getDb().insert(turns).values({
      tenantId: second.id,
      deviceId: theirs.id,
      userText: "hello",
      assistantText: "hi",
      language: "en",
      startedAt: new Date(),
      endedAt: new Date(),
    });
    assert.deepEqual(await adminTurns(theirs.id, 10, first.id), []);
    assert.equal((await adminTurns(theirs.id, 10, second.id)).length, 1);

    const claim = await getDb()
      .insert(claims)
      .values({
        tenantId: second.id,
        deviceId: "bdevice",
        code: "123456",
        expiresAt: new Date(Date.now() + 60_000),
        consumedAt: new Date(),
        userId: bob.id,
      })
      .returning();
    assert.deepEqual(await listPendingRequests(first.id), []);
    assert.equal((await listPendingRequests(second.id)).length, 1);
    assert.equal(
      await approveClaim("root@example.com", claim[0]!.id, first.id),
      "not-found"
    );
  });

  it("lists and targets firmware inside one tenant only", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const mine = await firmware(first.id, "esp-box-3", "1.0.0");
    const theirs = await firmware(second.id, "esp-box-3", "1.0.0");

    assert.deepEqual((await listFirmware(first.id)).map((row) => row.id), [mine.id]);
    assert.equal(await markFirmwareTarget(theirs.id, false, "root@example.com", first.id), "not-found");
    assert.equal(await markFirmwareTarget(mine.id, false, "root@example.com", first.id), "targeted");
    assert.equal((await targetFor("esp-box-3", first.id))?.id, mine.id);
    assert.equal(await targetFor("esp-box-3", second.id), undefined);
  });

  it("lists the platform, tenant and account profiles visible to one tenant", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const ann = await account("ann@example.com", first.id);
    const bob = await account("bob@example.com", second.id);

    await getDb().insert(providerProfiles).values({
      tenantId: null,
      userId: null,
      kind: "llm",
      name: "Platform model",
      baseUrl: "https://platform.example/v1",
      model: "platform",
      builtin: true,
    });
    const mine = await createProviderProfile(ann.id, {
      kind: "llm",
      name: "Ann model",
      baseUrl: "https://ann.example/v1",
      model: "ann",
      voice: null,
      temperature: null,
    });
    const theirs = await createProviderProfile(bob.id, {
      kind: "llm",
      name: "Bob model",
      baseUrl: "https://bob.example/v1",
      model: "bob",
      voice: null,
      temperature: null,
    });

    const profiles = await listTenantProviderProfiles(first.id);
    assert.ok(profiles.some((row) => row.id === mine.id && row.scope === "account"));
    assert.ok(profiles.some((row) => row.scope === "platform"));
    assert.ok(!profiles.some((row) => row.id === theirs.id));
  });
});
