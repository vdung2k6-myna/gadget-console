import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import {
  allowClaimIssue,
  approveClaim,
  claimDevice,
  findOwnedDevice,
  listPendingRequests,
  pendingRequestsFor,
  rejectClaim,
  issueClaim,
  normalizeDeviceId,
  releaseDevice,
  resetClaimRateLimit,
} from "../src/lib/claims";
import { claims, devices, turns } from "../src/lib/db/schema";
import { ownDevice } from "./helpers/own";

async function claimIdFor(code: string): Promise<string> {
  const rows = await getDb().select({ id: claims.id }).from(claims).where(eq(claims.code, code)).limit(1);
  return rows[0]!.id;
}

before(() => requireTestDatabase());
beforeEach(async () => {
  await resetDb();
  resetClaimRateLimit();
});
after(closeDb);

const MAC = "B8-1F-3F-4A-9B-01";
const NORMALIZED = "b81f3f4a9b01";

async function account(email: string) {
  const result = await registerAccount(email, "a good password");
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

describe("issuing a claim", () => {
  it("creates an unowned device with its own secret and a short code", async () => {
    const issued = await issueClaim(MAC);
    assert.ok(issued);
    assert.equal(issued.code.length, 6);
    assert.ok(issued.expiresAt.getTime() > Date.now());

    const rows = await getDb().select().from(devices);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.deviceId, NORMALIZED);
    assert.equal(rows[0]?.userId, null);
    assert.ok((rows[0]?.secret.length ?? 0) >= 32);
  });

  it("reuses the live claim rather than issuing a second code", async () => {
    const first = await issueClaim(MAC);
    const second = await issueClaim(MAC);
    assert.equal(first?.code, second?.code);
    assert.equal((await getDb().select().from(claims)).length, 1);
  });

  it("issues nothing for a gadget that already has an owner", async () => {
    const ann = await account("ann@example.com");
    const issued = await issueClaim(MAC);
    assert.ok(issued);
    await claimDevice(ann.id, issued.code);

    assert.equal(await issueClaim(MAC), undefined);
  });

  it("normalizes the identifier the bridge normalizes", () => {
    assert.equal(normalizeDeviceId(" B8:1F:3F:4A:9B:01 "), NORMALIZED);
    assert.equal(normalizeDeviceId("b81f3f4a9b01"), NORMALIZED);
  });
});

describe("entering a code", () => {
  it("records a request, and hands the gadget over only when it is approved", async () => {
    const ann = await account("ann@example.com");
    const issued = await issueClaim(MAC);
    assert.ok(issued);

    const result = await claimDevice(ann.id, issued.code);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const before = await findOwnedDevice(MAC);
    assert.equal(before[0]?.userId, null, "entering a code is a request, not ownership");

    const claimId = await claimIdFor(issued.code);
    assert.equal(await approveClaim("admin@example.com", claimId), "approved");

    const after = await findOwnedDevice(MAC);
    assert.equal(after[0]?.userId, ann.id);
  });

  it("refuses a code a second time", async () => {
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const issued = await issueClaim(MAC);
    assert.ok(issued);

    await claimDevice(ann.id, issued.code);
    assert.deepEqual(await claimDevice(bob.id, issued.code), { ok: false, reason: "invalid" });
  });

  it("leaves exactly one request when two accounts race", async () => {
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const issued = await issueClaim(MAC);
    assert.ok(issued);

    const [first, second] = await Promise.all([
      claimDevice(ann.id, issued.code),
      claimDevice(bob.id, issued.code),
    ]);
    assert.equal([first, second].filter((result) => result.ok).length, 1);
  });

  it("refuses an expired code, and a fresh request issues a new one", async () => {
    const issued = await issueClaim(MAC);
    assert.ok(issued);
    await getDb()
      .update(claims)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(claims.code, issued.code));

    const ann = await account("ann@example.com");
    assert.deepEqual(await claimDevice(ann.id, issued.code), { ok: false, reason: "expired" });

    // Released: it can be claimed again, with a code issued afresh.
    const fresh = await issueClaim(MAC);
    assert.ok(fresh);
    assert.match(fresh.code, /^\d{6}$/);
  });

  it("refuses a code nobody issued", async () => {
    const ann = await account("ann@example.com");
    assert.deepEqual(await claimDevice(ann.id, "000000"), { ok: false, reason: "invalid" });
  });
});

describe("approving a request", () => {
  it("lists it for the admin and for the account that asked", async () => {
    const ann = await account("ann@example.com");
    const issued = await issueClaim(MAC);
    assert.ok(issued);
    await claimDevice(ann.id, issued.code);

    const forUser = await pendingRequestsFor(ann.id);
    assert.equal(forUser.length, 1);
    assert.equal(forUser[0]?.deviceId, "b81f3f4a9b01");
    assert.equal(forUser[0]?.requesterEmail, "ann@example.com");

    const forAdmin = await listPendingRequests();
    assert.equal(forAdmin.length, 1);
  });

  it("refusing leaves the gadget unowned, and the code cannot be used again", async () => {
    const ann = await account("ann@example.com");
    const issued = await issueClaim(MAC);
    assert.ok(issued);
    await claimDevice(ann.id, issued.code);
    const claimId = await claimIdFor(issued.code);

    assert.equal(await rejectClaim("admin@example.com", claimId), "rejected");
    assert.equal((await findOwnedDevice(MAC))[0]?.userId, null);
    assert.equal((await listPendingRequests()).length, 0);
    assert.equal((await claimDevice(ann.id, issued.code)).ok, false, "the code was used");
  });

  it("will not approve a request past its window", async () => {
    const ann = await account("ann@example.com");
    const issued = await issueClaim(MAC);
    assert.ok(issued);
    await claimDevice(ann.id, issued.code);
    const claimId = await claimIdFor(issued.code);
    await getDb()
      .update(claims)
      .set({ consumedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(claims.id, claimId));

    assert.equal((await listPendingRequests()).length, 0);
    assert.equal(await approveClaim("admin@example.com", claimId), "expired");
  });

  it("will not approve over a device that was claimed meanwhile", async () => {
    const ann = await account("ann@example.com");
    const issued = await issueClaim(MAC);
    assert.ok(issued);
    await claimDevice(ann.id, issued.code);
    const claimId = await claimIdFor(issued.code);

    // Somebody else got there another way (an operator, a migration).
    await getDb()
      .update(devices)
      .set({ userId: ann.id })
      .where(eq(devices.deviceId, "b81f3f4a9b01"));
    assert.equal(await approveClaim("admin@example.com", claimId), "taken");
  });
});

describe("releasing a gadget", () => {
  it("takes the owner, the secret and the record away", async () => {
    const ann = await account("ann@example.com");
    const claimed = await ownDevice(ann.id, MAC);
    const before = claimed.secret;

    const now = new Date();
    await getDb().insert(turns).values({
      deviceId: claimed.id,
      userText: "xin chào",
      assistantText: "chào bạn",
      language: "vietnamese",
      engine: "kokoro",
      startedAt: now,
      endedAt: now,
    });

    assert.equal(await releaseDevice(ann.id, claimed.id), true);

    const rows = await getDb().select().from(devices);
    assert.equal(rows[0]?.userId, null);
    assert.notEqual(rows[0]?.secret, before);
    assert.equal((await getDb().select().from(turns)).length, 0);

    // Released: it can be claimed again, with a code issued afresh.
    const fresh = await issueClaim(MAC);
    assert.ok(fresh);
    assert.match(fresh.code, /^\d{6}$/);
  });

  it("refuses to release another account's gadget", async () => {
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const claimed = await ownDevice(ann.id, MAC);

    assert.equal(await releaseDevice(bob.id, claimed.id), false);
    assert.equal((await findOwnedDevice(MAC))[0]?.userId, ann.id);
  });
});

describe("the issue rate limit", () => {
  it("allows a burst and then refuses", () => {
    const results = Array.from({ length: 12 }, () => allowClaimIssue(MAC));
    assert.equal(results.filter(Boolean).length, 10);
    assert.equal(results.slice(10).every((allowed) => allowed === false), true);
  });
});
