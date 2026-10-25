import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, SecretBoxError } from "../src/lib/crypto/secret-box";
import { publicProfile } from "../src/lib/crypto/profiles";

const KEY = randomBytes(32);

describe("an encrypted secret", () => {
  it("comes back exactly as it went in", () => {
    const stored = encryptSecret("sk-live-abc123", KEY);
    assert.notEqual(stored, "sk-live-abc123");
    assert.ok(stored.startsWith("v1:"));
    assert.equal(decryptSecret(stored, KEY), "sk-live-abc123");
  });

  it("uses a fresh IV every time, so one key encrypts differently twice", () => {
    const first = encryptSecret("same", KEY);
    const second = encryptSecret("same", KEY);
    assert.notEqual(first, second);
    assert.equal(decryptSecret(first, KEY), "same");
    assert.equal(decryptSecret(second, KEY), "same");
  });

  it("refuses a tampered ciphertext rather than returning something", () => {
    const stored = encryptSecret("sk-live-abc123", KEY);
    const parts = stored.split(":");
    const bytes = Buffer.from(parts[3]!, "base64url");
    bytes[0] = bytes[0]! ^ 0xff;
    parts[3] = bytes.toString("base64url");

    assert.throws(() => decryptSecret(parts.join(":"), KEY), SecretBoxError);
  });

  it("refuses another key", () => {
    const stored = encryptSecret("sk-live-abc123", KEY);
    assert.throws(() => decryptSecret(stored, randomBytes(32)), /could not be authenticated/);
  });

  it("refuses a version it does not know, rather than guessing", () => {
    const stored = encryptSecret("sk-live-abc123", KEY).replace(/^v1:/, "v9:");
    assert.throws(() => decryptSecret(stored, KEY), /version "v9"/);
  });

  it("refuses a key that is not 32 bytes", () => {
    assert.throws(() => encryptSecret("x", randomBytes(16)), /32 bytes/);
    assert.throws(() => decryptSecret("v1:a:b:c", randomBytes(16)), /32 bytes/);
  });
});

describe("a profile as anything but the bridge sees it", () => {
  it("carries no key material, not even the ciphertext", () => {
    const stored = encryptSecret("sk-live-abc123", KEY);
    const shown = JSON.stringify(
      publicProfile({
        id: "id-1",
        userId: "user-1",
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        encryptedKey: stored,
        temperature: 0.4,
        createdAt: new Date(),
      })
    );

    assert.equal(shown.includes("sk-live-abc123"), false);
    assert.equal(shown.includes(stored), false);
    assert.equal(shown.includes("encryptedKey"), false);
    assert.ok(shown.includes('"hasKey":true'));
  });
});
