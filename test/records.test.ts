import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { ownTurns } from "../src/lib/auth/ownership";
import { releaseDevice } from "../src/lib/claims";
import { pruneTurns } from "../src/lib/retention";
import { devices, turns } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function account(email: string) {
  const result = await registerAccount(email, "a good password");
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

async function device(userId: string, deviceId: string) {
  const rows = await getDb()
    .insert(devices)
    .values({ deviceId, userId, secret: "s".repeat(32) })
    .returning();
  return rows[0]!;
}

async function turn(deviceRowId: string, userText: string, createdAt = new Date()) {
  await getDb().insert(turns).values({
    deviceId: deviceRowId,
    userText,
    assistantText: `answer ${userText}`,
    language: "vietnamese",
    engine: "kokoro",
    startedAt: createdAt,
    endedAt: createdAt,
    createdAt,
  });
}

describe("reading a device's record", () => {
  it("returns that device's turns and no other device's", async () => {
    const ann = await account("ann@example.com");
    const one = await device(ann.id, "aa:aa:aa:aa:aa:01");
    const two = await device(ann.id, "aa:aa:aa:aa:aa:02");
    await turn(one.id, "first");
    await turn(two.id, "second");

    const rows = await ownTurns(ann.id, one.id, 50);
    assert.deepEqual(
      rows?.map((row) => row.userText),
      ["first"]
    );
  });
});

describe("retention", () => {
  it("deletes what is past the period and keeps what is not", async () => {
    const ann = await account("ann@example.com");
    const one = await device(ann.id, "aa:aa:aa:aa:aa:01");
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await turn(one.id, "old", old);
    await turn(one.id, "recent");

    assert.equal(await pruneTurns(90), 1);
    const rows = await getDb().select().from(turns);
    assert.deepEqual(
      rows.map((row) => row.userText),
      ["recent"]
    );
  });
});

describe("release", () => {
  it("deletes the device's records with it", async () => {
    const ann = await account("ann@example.com");
    const one = await device(ann.id, "aa:aa:aa:aa:aa:01");
    await turn(one.id, "something");

    assert.equal(await releaseDevice(ann.id, one.id), true);
    assert.equal((await getDb().select().from(turns)).length, 0);
  });
});
