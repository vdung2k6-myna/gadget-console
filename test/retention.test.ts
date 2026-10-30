import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { pruneAll, pruneClaims, pruneTurns, pruneUnclaimedDevices } from "../src/lib/retention";
import { claims, devices, turns } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const now = new Date("2026-10-25T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

async function account(email: string) {
  const result = await registerAccount(email, "a good password");
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

async function gadget(deviceId: string, userId: string | null, createdAt: Date) {
  const rows = await getDb()
    .insert(devices)
    .values({ deviceId, userId, secret: "s".repeat(32), createdAt })
    .returning();
  return rows[0]!;
}

interface ClaimSeed {
  deviceId: string;
  code: string;
  createdAt?: Date;
  expiresAt: Date;
  consumedAt?: Date | null;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;
}

async function claim(seed: ClaimSeed) {
  await getDb()
    .insert(claims)
    .values({
      deviceId: seed.deviceId,
      code: seed.code,
      createdAt: seed.createdAt ?? ago(DAY),
      expiresAt: seed.expiresAt,
      consumedAt: seed.consumedAt ?? null,
      approvedAt: seed.approvedAt ?? null,
      rejectedAt: seed.rejectedAt ?? null,
    });
}

async function counts() {
  const [deviceRows, claimRows] = await Promise.all([
    getDb().select().from(devices),
    getDb().select().from(claims),
  ]);
  return { devices: deviceRows.length, claims: claimRows.length };
}

describe("the unowned devices the console forgets", () => {
  it("removes one that aged out, and the claims naming it", async () => {
    await gadget("aa:aa:aa:aa:aa:01", null, ago(8 * DAY));
    await claim({ deviceId: "aa:aa:aa:aa:aa:01", code: "123456", expiresAt: ago(8 * DAY) });

    assert.deepEqual(await pruneUnclaimedDevices(now, 100), { devices: 1, claims: 1 });
    assert.deepEqual(await counts(), { devices: 0, claims: 0 });
  });

  it("keeps one whose code is still on its screen", async () => {
    await gadget("aa:aa:aa:aa:aa:02", null, ago(8 * DAY));
    await claim({ deviceId: "aa:aa:aa:aa:aa:02", code: "234567", expiresAt: ago(-5 * MINUTE) });

    assert.deepEqual(await pruneUnclaimedDevices(now, 100), { devices: 0, claims: 0 });
    assert.equal((await counts()).devices, 1);
  });

  it("keeps one whose code somebody entered and an admin has not decided", async () => {
    // The row is a month old; the request is an hour old. Age alone would strand
    // the decision the admin is about to make.
    await gadget("aa:aa:aa:aa:aa:03", null, ago(30 * DAY));
    await claim({
      deviceId: "aa:aa:aa:aa:aa:03",
      code: "345678",
      expiresAt: ago(29 * DAY),
      consumedAt: ago(HOUR),
    });

    assert.deepEqual(await pruneUnclaimedDevices(now, 100), { devices: 0, claims: 0 });
    assert.equal((await counts()).devices, 1);
  });

  it("removes an abandoned request once the approval period passes", async () => {
    await gadget("aa:aa:aa:aa:aa:04", null, ago(30 * DAY));
    await claim({
      deviceId: "aa:aa:aa:aa:aa:04",
      code: "456789",
      expiresAt: ago(29 * DAY),
      consumedAt: ago(2 * DAY),
    });

    assert.deepEqual(await pruneUnclaimedDevices(now, 100), { devices: 1, claims: 1 });
  });

  it("never removes a device that has an owner", async () => {
    const ann = await account("ann@example.com");
    await gadget("aa:aa:aa:aa:aa:05", ann.id, ago(365 * DAY));

    assert.deepEqual(await pruneUnclaimedDevices(now, 100), { devices: 0, claims: 0 });
    assert.equal((await counts()).devices, 1);
  });

  it("stops at the batch and finishes on the next pass", async () => {
    for (const suffix of ["06", "07", "08"]) {
      await gadget(`aa:aa:aa:aa:aa:${suffix}`, null, ago(8 * DAY));
    }

    assert.equal((await pruneUnclaimedDevices(now, 2)).devices, 2);
    assert.equal((await counts()).devices, 1);
    assert.equal((await pruneUnclaimedDevices(now, 2)).devices, 1);
    assert.equal((await counts()).devices, 0);
  });
});

describe("claims nothing can be done with", () => {
  it("removes a code that died unentered and a decision too old to explain anything", async () => {
    await claim({ deviceId: "aa:aa:aa:aa:aa:11", code: "111111", expiresAt: ago(DAY) });
    await claim({
      deviceId: "aa:aa:aa:aa:aa:12",
      code: "121212",
      expiresAt: ago(2 * DAY),
      consumedAt: ago(2 * DAY),
      approvedAt: ago(2 * DAY),
    });

    assert.equal(await pruneClaims(now, 100), 2);
    assert.equal((await counts()).claims, 0);
  });

  it("keeps a live code and a request still inside the approval period", async () => {
    await claim({ deviceId: "aa:aa:aa:aa:aa:13", code: "131313", expiresAt: ago(-5 * MINUTE) });
    await claim({
      deviceId: "aa:aa:aa:aa:aa:14",
      code: "141414",
      expiresAt: ago(MINUTE),
      consumedAt: ago(HOUR),
    });
    await claim({
      deviceId: "aa:aa:aa:aa:aa:15",
      code: "151515",
      expiresAt: ago(2 * DAY),
      consumedAt: ago(2 * DAY),
      rejectedAt: ago(HOUR),
    });

    assert.equal(await pruneClaims(now, 100), 0);
    assert.equal((await counts()).claims, 3);
  });

  it("removes a request nobody decided within the approval period", async () => {
    await claim({
      deviceId: "aa:aa:aa:aa:aa:16",
      code: "161616",
      expiresAt: ago(2 * DAY),
      consumedAt: ago(2 * DAY),
    });

    assert.equal(await pruneClaims(now, 100), 1);
  });

  it("stops at the batch", async () => {
    for (const code of ["171717", "181818", "191919"]) {
      await claim({ deviceId: `aa:aa:aa:aa:aa:${code.slice(0, 2)}`, code, expiresAt: ago(DAY) });
    }

    assert.equal(await pruneClaims(now, 2), 2);
    assert.equal((await counts()).claims, 1);
  });
});

describe("one scheduled pass", () => {
  it("reports what each table lost", async () => {
    const ann = await account("ann@example.com");
    const owned = await gadget("aa:aa:aa:aa:aa:21", ann.id, ago(20 * DAY));
    await getDb().insert(turns).values({
      deviceId: owned.id,
      userText: "old",
      assistantText: "answer",
      language: "vietnamese",
      engine: "engine-a",
      startedAt: ago(120 * DAY),
      endedAt: ago(120 * DAY),
      createdAt: ago(120 * DAY),
    });
    await gadget("aa:aa:aa:aa:aa:22", null, ago(8 * DAY));
    await claim({ deviceId: "aa:aa:aa:aa:aa:22", code: "222222", expiresAt: ago(8 * DAY) });

    assert.deepEqual(await pruneAll(now), { devices: 1, claims: 1, turns: 1 });
    assert.deepEqual(await counts(), { devices: 1, claims: 0 });
  });
});
