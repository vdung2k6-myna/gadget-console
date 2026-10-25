import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { authenticate, registerAccount } from "../src/lib/auth/accounts";
import {
  createSession,
  destroySession,
  findSessionUser,
  hashSessionToken,
  newSessionToken,
} from "../src/lib/auth/session";
import { sessions, users } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

describe("registration", () => {
  it("creates an account and stores a hash rather than the password", async () => {
    const result = await registerAccount("Ann@Example.com", "a good password");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const rows = await getDb().select().from(users).where(eq(users.id, result.user.id));
    assert.equal(rows[0]?.email, "ann@example.com");
    assert.notEqual(rows[0]?.passwordHash, "a good password");
  });

  it("refuses an address that already has an account, whatever its case", async () => {
    await registerAccount("ann@example.com", "a good password");
    const second = await registerAccount("ANN@example.com", "another password");
    assert.deepEqual(second, { ok: false, reason: "taken" });
  });

  it("refuses what is not an address and what is too short a password", async () => {
    assert.deepEqual(await registerAccount("not-an-address", "a good password"), {
      ok: false,
      reason: "invalid-email",
    });
    assert.deepEqual(await registerAccount("ann@example.com", "short"), {
      ok: false,
      reason: "weak-password",
    });
  });
});

describe("sign-in", () => {
  it("accepts the right password and refuses the wrong one or an unknown address", async () => {
    await registerAccount("ann@example.com", "a good password");

    const good = await authenticate("ann@example.com", "a good password");
    assert.equal(good?.email, "ann@example.com");

    assert.equal(await authenticate("ann@example.com", "a bad password"), undefined);
    assert.equal(await authenticate("nobody@example.com", "a good password"), undefined);
  });
});

describe("sessions", () => {
  it("finds the account behind a live session", async () => {
    const registration = await registerAccount("ann@example.com", "a good password");
    assert.equal(registration.ok, true);
    if (!registration.ok) return;

    const session = await createSession(registration.user.id);
    const user = await findSessionUser(session.token);
    assert.equal(user?.id, registration.user.id);
  });

  it("stops finding it once it is signed out", async () => {
    const registration = await registerAccount("ann@example.com", "a good password");
    if (!registration.ok) return;

    const session = await createSession(registration.user.id);
    await destroySession(session.token);
    assert.equal(await findSessionUser(session.token), undefined);
  });

  it("stops finding it once it has expired", async () => {
    const registration = await registerAccount("ann@example.com", "a good password");
    if (!registration.ok) return;

    const token = newSessionToken();
    await getDb()
      .insert(sessions)
      .values({
        tokenHash: hashSessionToken(token),
        userId: registration.user.id,
        expiresAt: new Date(Date.now() - 1000),
      });

    assert.equal(await findSessionUser(token), undefined);
  });

  it("does not store the token itself", async () => {
    const registration = await registerAccount("ann@example.com", "a good password");
    if (!registration.ok) return;

    const session = await createSession(registration.user.id);
    const rows = await getDb().select().from(sessions);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0]?.tokenHash, session.token);
  });
});
