import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import {
  createProviderProfile,
  defaultProviderProfile,
  defaultProviderProfileFor,
  findProviderProfile,
  listProviderProfiles,
  providersForAgent,
} from "../src/lib/provider-profiles";
import { providerProfiles, tenants, users } from "../src/lib/db/schema";

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

async function builtin(name: string, tenantId: string | null, isDefault = true) {
  const rows = await getDb()
    .insert(providerProfiles)
    .values({
      tenantId,
      userId: null,
      builtin: true,
      isDefault,
      kind: "tts",
      name,
      baseUrl: "https://example.com/v1",
      model: "m",
      voice: "v",
    })
    .returning();
  return rows[0]!;
}

describe("provider profile scopes", () => {
  it("separates platform, tenant and account profiles", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const ann = await account("ann@example.com", first.id);
    const bob = await account("bob@example.com", second.id);

    const own = await createProviderProfile(ann.id, {
      kind: "tts",
      name: "ann-voice",
      baseUrl: "https://example.com/v1",
      model: "m",
      voice: "v",
      temperature: null,
    });
    const firstBuiltin = await builtin("first-voice", first.id);
    const secondBuiltin = await builtin("second-voice", second.id);
    const platformBuiltin = await builtin("platform-voice", null);

    assert.equal(own.tenantId, first.id);

    const visible = (await listProviderProfiles(ann.id)).map((row) => row.name).sort();
    assert.deepEqual(visible, ["ann-voice", "first-voice", "platform-voice"]);

    assert.equal((await findProviderProfile(ann.id, own.id))?.id, own.id);
    assert.equal((await findProviderProfile(ann.id, firstBuiltin.id))?.id, firstBuiltin.id);
    assert.equal((await findProviderProfile(ann.id, platformBuiltin.id))?.id, platformBuiltin.id);
    assert.equal(await findProviderProfile(ann.id, secondBuiltin.id), undefined);
    assert.equal(await findProviderProfile(bob.id, own.id), undefined);
  });

  it("prefers a tenant default and falls back to the platform default", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const ann = await account("ann@example.com", first.id);
    const firstDefault = await builtin("first-voice", first.id);
    const secondDefault = await builtin("second-voice", second.id);
    const platformDefault = await builtin("platform-voice", null);

    assert.equal((await defaultProviderProfile("tts", first.id))?.id, firstDefault.id);
    assert.equal((await defaultProviderProfile("tts", second.id))?.id, secondDefault.id);
    assert.equal((await defaultProviderProfile("tts"))?.id, platformDefault.id);
    assert.equal((await defaultProviderProfileFor(ann.id, "tts"))?.id, firstDefault.id);

    const providers = await providersForAgent(
      ann.id,
      { stt: null, tts: null, llm: null },
      undefined,
      { allowCustom: false }
    );
    assert.equal(providers.tts?.name, "first-voice");
    assert.equal(providers.stt, null);
    assert.equal(providers.llm, null);
    assert.ok((await getDb().select().from(users)).length >= 1);
  });
});
