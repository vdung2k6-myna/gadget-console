import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { ownAgent, ownDevice, ownTurns } from "../src/lib/auth/ownership";
import { agents, devices, runtimes, turns } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function twoAccounts() {
  const ann = await registerAccount("ann@example.com", "a good password");
  const bob = await registerAccount("bob@example.com", "a good password");
  assert.equal(ann.ok, true);
  assert.equal(bob.ok, true);
  if (!ann.ok || !bob.ok) throw new Error("accounts were not created");
  return { ann: ann.user, bob: bob.user };
}

async function everythingFor(userId: string) {
  const runtime = (
    await getDb()
      .insert(runtimes)
      .values({
        name: "test",
        baseUrl: "http://127.0.0.1:4000",
        token: "runtime-token",
        engines: ["engine-a"],
        languages: ["vietnamese"],
      })
      .returning()
  )[0]!;

  const agent = (
    await getDb()
      .insert(agents)
      .values({
        userId,
        runtimeId: runtime.id,
        name: "assistant",
        systemPrompt: "be helpful",
        language: "vietnamese",
        engine: "engine-a",
      })
      .returning()
  )[0]!;

  const device = (
    await getDb()
      .insert(devices)
      .values({ deviceId: "b8:1f:3f:4a:9b:01", userId, secret: "s".repeat(32) })
      .returning()
  )[0]!;

  const now = new Date();
  await getDb().insert(turns).values({
    deviceId: device.id,
    userText: "xin chào",
    assistantText: "chào bạn",
    language: "vietnamese",
    engine: "engine-a",
    startedAt: now,
    endedAt: now,
  });

  return { agent, device };
}

describe("ownership scoping", () => {
  it("finds an account's own device and refuses another account's", async () => {
    const { ann, bob } = await twoAccounts();
    const { device } = await everythingFor(ann.id);

    assert.equal((await ownDevice(ann.id, device.id))?.id, device.id);
    assert.equal(await ownDevice(bob.id, device.id), undefined);
    assert.equal(await ownDevice(bob.id, "00000000-0000-0000-0000-000000000000"), undefined);
  });

  it("does the same for an agent", async () => {
    const { ann, bob } = await twoAccounts();
    const { agent } = await everythingFor(ann.id);

    assert.equal((await ownAgent(ann.id, agent.id))?.id, agent.id);
    assert.equal(await ownAgent(bob.id, agent.id), undefined);
  });

  it("reads turns only for the device's owner", async () => {
    const { ann, bob } = await twoAccounts();
    const { device } = await everythingFor(ann.id);

    const mine = await ownTurns(ann.id, device.id, 10);
    assert.equal(mine?.length, 1);
    assert.equal(mine?.[0]?.userText, "xin chào");

    assert.equal(await ownTurns(bob.id, device.id, 10), undefined);
  });
});
