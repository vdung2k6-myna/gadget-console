import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";

describe("password hashing", () => {
  it("verifies the password it hashed", async () => {
    const stored = await hashPassword("correct horse battery");
    assert.notEqual(stored, "correct horse battery");
    assert.ok(stored.startsWith("scrypt$"));
    assert.equal(await verifyPassword("correct horse battery", stored), true);
  });

  it("refuses a different password", async () => {
    const stored = await hashPassword("correct horse battery");
    assert.equal(await verifyPassword("correct horse batteru", stored), false);
  });

  it("salts, so one password hashes differently every time", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    assert.notEqual(a, b);
    assert.equal(await verifyPassword("same password", a), true);
    assert.equal(await verifyPassword("same password", b), true);
  });

  it("answers false — rather than throwing — for a hash it did not write", async () => {
    assert.equal(await verifyPassword("anything", "not-a-hash"), false);
    assert.equal(await verifyPassword("anything", "scrypt$1$2$3$bad"), false);
  });
});
