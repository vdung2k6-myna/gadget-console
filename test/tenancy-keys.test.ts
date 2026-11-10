import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { decryptSecret, SecretBoxError } from "../src/lib/crypto/secret-box";
import {
  encryptionKey,
  encryptionKeyForTenant,
  storeKey,
  storeKeyForTenant,
} from "../src/lib/crypto/profiles";
import { reencryptProviderKeys } from "../src/lib/tenancy/keys";
import { providerProfiles, tenants } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

describe("tenant envelope keys", () => {
  it("derives a different key per tenant", () => {
    const first = encryptionKeyForTenant("first");
    const second = encryptionKeyForTenant("second");

    assert.equal(first.length, 32);
    assert.notDeepEqual(first, second);
    assert.deepEqual(encryptionKeyForTenant(null), encryptionKey());

    const stored = storeKeyForTenant("first", "sk-secret");
    assert.equal(decryptSecret(stored, first), "sk-secret");
    assert.throws(() => decryptSecret(stored, second), SecretBoxError);
    assert.throws(() => decryptSecret(stored, encryptionKey()), SecretBoxError);
  });

  it("re-encrypts a legacy master-key row under its tenant key", async () => {
    const [tenant] = await getDb()
      .insert(tenants)
      .values({ name: "first", slug: "first" })
      .returning();

    await getDb().insert(providerProfiles).values({
      tenantId: tenant.id,
      userId: null,
      builtin: true,
      kind: "llm",
      name: "legacy",
      baseUrl: "https://example.com/v1",
      model: "m",
      encryptedKey: storeKey("sk-legacy"),
    });

    const dry = await reencryptProviderKeys({ dryRun: true });
    assert.equal(dry.reencrypted, 1);
    const unchanged = (await getDb().select().from(providerProfiles))[0]!;
    assert.throws(
      () => decryptSecret(unchanged.encryptedKey, encryptionKeyForTenant(tenant.id)),
      SecretBoxError
    );

    const applied = await reencryptProviderKeys();
    assert.equal(applied.reencrypted, 1);

    const migrated = (await getDb().select().from(providerProfiles))[0]!;
    assert.equal(decryptSecret(migrated.encryptedKey, encryptionKeyForTenant(tenant.id)), "sk-legacy");
    assert.throws(
      () => decryptSecret(migrated.encryptedKey, encryptionKeyForTenant("another")),
      SecretBoxError
    );

    const again = await reencryptProviderKeys();
    assert.equal(again.skipped, 1, "a row already under its tenant key is skipped");
  });
});
