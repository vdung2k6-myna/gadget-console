import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { accountWithTenant, tenantOfUser, testTenant } from "./helpers/tenant";
import { registerAccount } from "../src/lib/auth/accounts";
import { createAdapter } from "../src/lib/adapters";
import { validateAgentDraft, createAgent } from "../src/lib/agents";
import { resolveDevice } from "../src/lib/bridge/registry";
import { resetClaimRateLimit } from "../src/lib/claims";
import { ownDevice as own } from "./helpers/own";
import {
  agentsUsingProvider,
  createProviderProfile,
  deleteProviderProfile,
  findProviderProfile,
  listProviderProfiles,
  publicProviderProfile,
  runtimeProvider,
  providerChainForAgent,
  providersForAgent,
  publishTenantBuiltin,
  updateProviderProfile,
  validateProviderDraft,
  validateProviderDraftForUser,
} from "../src/lib/provider-profiles";
import { createRuntime } from "../src/lib/runtimes";
import {
  agents,
  devices,
  providerAdapters,
  providerProfiles,
  tenants,
  users,
} from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(async () => {
  await resetDb();
  resetClaimRateLimit();
});
after(closeDb);

const MAC = "B8:1F:3F:4A:9B:01";

async function account(email: string) {
  return accountWithTenant(email);
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    kind: "llm",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1/",
    model: "gpt-4o-mini",
    apiKey: "sk-live-abc123",
    temperature: 0.4,
    ...overrides,
  };
}

async function profileFor(userId: string, overrides: Record<string, unknown> = {}) {
  const validation = validateProviderDraft(draft(overrides), { requireKey: true });
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return createProviderProfile(userId, validation.draft);
}

async function anotherTenant(slug: string): Promise<string> {
  const rows = await getDb()
    .insert(tenants)
    .values({ name: slug, slug })
    .returning();
  return rows[0]!.id;
}

async function adapter(
  tenantId: string,
  options: { kinds?: string[]; name?: string } = {}
) {
  const name = options.name ?? "acme";
  const rows = await getDb()
    .insert(providerAdapters)
    .values({
      tenantId,
      name,
      endpoint: `https://${name}.example/v1`,
      kinds: options.kinds ?? ["llm"],
      status: "verified",
      health: "ok",
    })
    .returning();
  return rows[0]!;
}

function adapterDraft(adapterId: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: "llm",
    name: "Acme Gemini",
    adapterId,
    config: { model: "gemini-3-flash" },
    temperature: 0.2,
    ...overrides,
  };
}

describe("validating a provider profile", () => {
  it("accepts an OpenAI-compatible endpoint, and drops the trailing slash", () => {
    const result = validateProviderDraft(draft(), { requireKey: true });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.draft.baseUrl, "https://api.openai.com/v1");
    assert.equal(result.draft.temperature, 0.4);
  });

  it("refuses each field it cannot use", () => {
    for (const bad of [
      { name: "" },
      { baseUrl: "api.openai.com" },
      { baseUrl: "ftp://example.com" },
      { model: "" },
      { temperature: 3 },
      { temperature: -1 },
      { kind: "video" },
    ]) {
      assert.equal(
        validateProviderDraft(draft(bad), { requireKey: true }).ok,
        false,
        JSON.stringify(bad)
      );
    }
  });

  it("requires a key for an llm profile, and allows a local audio profile without one", () => {
    assert.equal(validateProviderDraft(draft({ apiKey: "" }), { requireKey: true }).ok, false);
    assert.equal(validateProviderDraft(draft({ apiKey: "" }), { requireKey: false }).ok, true);

    const localStt = validateProviderDraft(
      { kind: "stt", name: "audio.cpp", baseUrl: "http://localhost:8080", model: "stt", apiKey: "" },
      { requireKey: true }
    );
    assert.equal(localStt.ok, true);
  });

  it("requires a voice for a tts profile, and refuses one anywhere else", () => {
    const noVoice = { kind: "tts", name: "voice", baseUrl: "http://localhost:8082", model: "engine-a" };
    assert.equal(validateProviderDraft(noVoice, { requireKey: true }).ok, false);
    assert.equal(
      validateProviderDraft({ ...noVoice, voice: "example_voice" }, { requireKey: true }).ok,
      true
    );
    assert.equal(
      validateProviderDraft({ ...draft(), voice: "example_voice" }, { requireKey: true }).ok,
      false,
      "an llm profile has no voice"
    );
  });

  it("accepts an adapter-backed profile with no URL, model or key", () => {
    const result = validateProviderDraft(
      { kind: "llm", name: "Acme", adapterId: "adapter-1", config: { model: "x" } },
      { requireKey: true }
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.draft.adapterId, "adapter-1");
    assert.deepEqual(result.draft.config, { model: "x" });
    assert.equal(result.draft.baseUrl, null);
    assert.equal(result.draft.model, null);
    assert.equal(result.draft.apiKey, undefined);
  });

  it("refuses a profile that names both shapes, or neither", () => {
    const both = validateProviderDraft(
      draft({ adapterId: "adapter-1", config: {} }),
      { requireKey: true }
    );
    assert.equal(both.ok, false);
    if (both.ok) return;
    assert.match(both.errors.join(" "), /either an adapter or a base URL/);

    const neither = validateProviderDraft(
      { kind: "llm", name: "none", apiKey: "sk-live-abc123" },
      { requireKey: true }
    );
    assert.equal(neither.ok, false);
    if (neither.ok) return;
    assert.match(neither.errors.join(" "), /base URL is required/);
    assert.match(neither.errors.join(" "), /model is required/);
  });

  it("refuses a config that is not an object, and one on a direct profile", () => {
    for (const config of ["x", 1, [], true]) {
      assert.equal(
        validateProviderDraft(
          { kind: "llm", name: "Acme", adapterId: "adapter-1", config },
          { requireKey: true }
        ).ok,
        false,
        JSON.stringify(config)
      );
    }
    const direct = validateProviderDraft(draft({ config: {} }), { requireKey: true });
    assert.equal(direct.ok, false);
    if (direct.ok) return;
    assert.match(direct.errors.join(" "), /config belongs only to an adapter-backed profile/);
  });
});

describe("an adapter-backed profile", () => {
  it("saves and resolves to its adapter, with no endpoint or platform key", async () => {
    const ann = await account("ann@example.com");
    const tenantId = await tenantOfUser(ann.id);
    const registered = await adapter(tenantId);

    const validation = await validateProviderDraftForUser(
      ann.id,
      adapterDraft(registered.id),
      { requireKey: true }
    );
    assert.equal(validation.ok, true, JSON.stringify(validation));
    if (!validation.ok) return;
    const created = await createProviderProfile(ann.id, validation.draft);

    const stored = await findProviderProfile(ann.id, created.id);
    assert.equal(stored?.adapterId, registered.id);
    assert.deepEqual(stored?.config, { model: "gemini-3-flash" });
    assert.equal(stored?.encryptedKey, "");

    const shown = publicProviderProfile(stored!);
    assert.equal(shown.adapterId, registered.id);
    assert.equal(shown.baseUrl, null);
    assert.equal(shown.model, null);
    assert.equal(shown.hasKey, false);

    const runtime = runtimeProvider(stored!);
    assert.equal(runtime.adapterId, registered.id);
    assert.deepEqual(runtime.config, { model: "gemini-3-flash" });
    assert.equal(runtime.baseUrl, undefined);
    assert.equal(runtime.apiKey, undefined);
  });

  it("keeps the direct shape resolving exactly as before", async () => {
    const ann = await account("ann@example.com");
    const created = await profileFor(ann.id);

    const stored = await findProviderProfile(ann.id, created.id);
    const runtime = runtimeProvider(stored!);
    assert.equal(runtime.adapterId, undefined);
    assert.equal(runtime.baseUrl, "https://api.openai.com/v1");
    assert.equal(runtime.model, "gpt-4o-mini");
    assert.equal(runtime.apiKey, "sk-live-abc123");
    assert.equal(publicProviderProfile(stored!).adapterId, null);
  });

  it("refuses an adapter of another tenant or one that serves another kind", async () => {
    const ann = await account("ann@example.com");
    const bob = await accountWithTenant("bob@example.com", await anotherTenant("other"));
    const annTenant = await tenantOfUser(ann.id);
    const theirAdapter = await adapter(annTenant, { name: "acme" });
    const speechOnly = await adapter(annTenant, { name: "speech", kinds: ["stt", "tts"] });

    const foreign = await validateProviderDraftForUser(
      bob.id,
      adapterDraft(theirAdapter.id),
      { requireKey: true }
    );
    assert.equal(foreign.ok, false);
    if (!foreign.ok) {
      assert.match(foreign.errors.join(" "), /registered to this tenant/);
    }

    const wrongKind = await validateProviderDraftForUser(
      ann.id,
      adapterDraft(speechOnly.id),
      { requireKey: true }
    );
    assert.equal(wrongKind.ok, false);
    if (!wrongKind.ok) {
      assert.match(wrongKind.errors.join(" "), /does not serve a llm profile/);
    }
  });

  it("resolves the profile's adapter as the first chain candidate", async () => {
    const ann = await account("ann@example.com");
    const tenantId = await tenantOfUser(ann.id);
    const issued = await createAdapter(tenantId, {
      name: "acme",
      endpoint: "https://acme.example/v1",
      kinds: ["llm"],
      capabilities: { tools: true, languages: ["vi"] },
    });
    await getDb()
      .update(providerAdapters)
      .set({ status: "verified", health: "ok" })
      .where(eq(providerAdapters.id, issued.adapter.id));

    const validation = await validateProviderDraftForUser(
      ann.id,
      adapterDraft(issued.adapter.id, { config: { model: "gemini-3-flash" } }),
      { requireKey: true }
    );
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    const profile = await createProviderProfile(ann.id, validation.draft);

    const chain = await providerChainForAgent(ann.id, {
      stt: null,
      tts: null,
      llm: profile.id,
    });
    assert.equal(chain.llm.length, 1);
    assert.deepEqual(chain.llm[0], {
      adapterId: issued.adapter.id,
      endpoint: "https://acme.example/v1",
      token: issued.token,
      tenantId,
      config: { model: "gemini-3-flash" },
      capabilities: { tools: true, languages: ["vi"] },
      timeoutMs: 30_000,
    });
    assert.deepEqual(chain.stt, []);
    assert.deepEqual(chain.tts, []);
  });

  it("drops a stored direct key when the profile is switched to an adapter", async () => {
    const ann = await account("ann@example.com");
    const tenantId = await tenantOfUser(ann.id);
    const registered = await adapter(tenantId);
    const direct = await profileFor(ann.id);

    const validation = await validateProviderDraftForUser(
      ann.id,
      adapterDraft(registered.id),
      { requireKey: false }
    );
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    await updateProviderProfile(ann.id, direct.id, validation.draft);

    const stored = await findProviderProfile(ann.id, direct.id);
    assert.equal(stored?.adapterId, registered.id);
    assert.equal(stored?.encryptedKey, "");
    assert.equal(stored?.baseUrl, null);
  });
});

describe("a stored provider profile", () => {
  it("is listed without its key, and with the key still decryptable for the bridge", async () => {
    const ann = await account("ann@example.com");
    const created = await profileFor(ann.id);

    const listed = (await listProviderProfiles(ann.id)).map(publicProviderProfile);
    const shown = JSON.stringify(listed);
    assert.equal(shown.includes("sk-live-abc123"), false);
    assert.equal(shown.includes(created.encryptedKey), false);
    assert.equal(listed[0]?.hasKey, true);

    assert.equal(runtimeProvider(created).apiKey, "sk-live-abc123");
  });

  it("stores no key for a local provider, and says none is set", async () => {
    const ann = await account("ann@example.com");
    const validation = validateProviderDraft(
      { kind: "stt", name: "audio.cpp", baseUrl: "http://localhost:8080", model: "stt", apiKey: "" },
      { requireKey: true }
    );
    if (!validation.ok) throw new Error("draft should be valid");
    const created = await createProviderProfile(ann.id, validation.draft);

    // An empty key encrypted anyway would read as "a key is set" and send an
    // empty bearer to a local service that needs none.
    assert.equal(publicProviderProfile(created).hasKey, false);
    assert.equal(runtimeProvider(created).apiKey, undefined);
  });

  it("keeps its key when an edit leaves the key blank", async () => {
    const ann = await account("ann@example.com");
    const created = await profileFor(ann.id);

    const validation = validateProviderDraft(draft({ apiKey: "", model: "gpt-4o" }), {
      requireKey: false,
    });
    if (!validation.ok) throw new Error("draft should be valid");
    await updateProviderProfile(ann.id, created.id, validation.draft);

    const stored = await findProviderProfile(ann.id, created.id);
    assert.equal(stored?.model, "gpt-4o");
    assert.equal(runtimeProvider(stored!).apiKey, "sk-live-abc123");
  });

  it("refuses another account's profile for every operation", async () => {
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const created = await profileFor(ann.id);

    assert.equal(await findProviderProfile(bob.id, created.id), undefined);

    const validation = validateProviderDraft(draft(), { requireKey: false });
    if (!validation.ok) throw new Error("draft should be valid");
    assert.equal(await updateProviderProfile(bob.id, created.id, validation.draft), undefined);
    assert.deepEqual(await deleteProviderProfile(bob.id, created.id), {
      deleted: false,
      agentsAffected: 0,
    });
  });
});

describe("an agent's provider profile", () => {
  async function runtime() {
    return createRuntime({
      name: "interview",
      baseUrl: "http://127.0.0.1:4000",
      token: "runtime-token",
      engines: ["engine-a"],
      languages: ["vietnamese"],
    });
  }

  function agentDraft(runtimeId: string, llmProfileId: string | null) {
    return {
      name: "assistant",
      runtimeId,
      llmProfileId,
      sttProfileId: null,
      ttsProfileId: null,
      systemPrompt: "be helpful",
      language: "vietnamese",
      answerMode: "generate",
      topics: [],
    };
  }

  it("accepts one of the account's own, and refuses another account's", async () => {
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const rt = await runtime();
    const mine = await profileFor(ann.id);

    assert.equal((await validateAgentDraft(agentDraft(rt.id, mine.id), ann.id)).ok, true);

    const foreign = await validateAgentDraft(agentDraft(rt.id, mine.id), bob.id);
    assert.equal(foreign.ok, false);
    if (foreign.ok) return;
    assert.ok(foreign.errors.some((error) => error.includes("not one this account can name")));
  });

  it("deleting a profile leaves its agents without one, and says how many", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime();
    const profile = await profileFor(ann.id);

    const validation = await validateAgentDraft(agentDraft(rt.id, profile.id), ann.id);
    if (!validation.ok) throw new Error("draft should be valid");
    const agent = await createAgent(ann.id, validation.draft);

    assert.equal(await agentsUsingProvider(ann.id, profile.id), 1);
    assert.deepEqual(await deleteProviderProfile(ann.id, profile.id), {
      deleted: true,
      agentsAffected: 1,
    });

    const rows = await getDb().select().from(agents).where(eq(agents.id, agent.id));
    assert.equal(rows[0]?.llmProfileId, null);
    assert.equal((await getDb().select().from(providerProfiles)).length, 0);
  });
});

describe("the resolution the bridge receives", () => {
  async function claimedAgent() {
    const ann = await account("ann@example.com");
    // An account profile is an administrator's to name now; an owner answers on
    // the deployment's built-ins. This suite is about the account-profile path.
    await getDb().update(users).set({ role: "admin" }).where(eq(users.id, ann.id));
    const rt = createRuntime({
      name: "interview",
      baseUrl: "http://127.0.0.1:4000",
      token: "runtime-token",
      engines: ["engine-a"],
      languages: ["vietnamese"],
    });
    const runtime = await rt;

    const profile = await profileFor(ann.id);
    const validation = await validateAgentDraft(
      {
        name: "assistant",
        runtimeId: runtime.id,
        llmProfileId: profile.id,
        sttProfileId: null,
        ttsProfileId: null,
        voice: "bryce",
        ovcConfig: { enabled: false },
        systemPrompt: "be helpful",
        language: "vietnamese",
        answerMode: "generate",
        topics: [],
      },
      ann.id
    );
    if (!validation.ok) throw new Error(`draft should be valid: ${validation.errors.join("; ")}`);
    const agent = await createAgent(ann.id, validation.draft);

    const claimed = await own(ann.id, MAC);
    await getDb().update(devices).set({ agentId: agent.id }).where(eq(devices.id, claimed.id));
    return ann;
  }

  it("carries the profile and its key when the agent names one", async () => {
    await claimedAgent();
    const resolution = await resolveDevice(MAC, await testTenant());
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");

    const agent = resolution.body.agent as Record<string, unknown>;
    assert.deepEqual((agent.providers as Record<string, unknown>).llm, {
      path: "openai-compatible",
      kind: "llm",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-live-abc123",
      temperature: 0.4,
    });
  });

  it("carries null for a kind the agent names none of", async () => {
    await claimedAgent();
    const resolution = await resolveDevice(MAC, await testTenant());
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");

    const providers = (resolution.body.agent as Record<string, unknown>).providers as Record<string, unknown>;
    assert.equal(providers.stt, null);
    assert.equal(providers.tts, null);
    assert.notEqual(providers.llm, null, "the answering model is required, so it is always named");
  });

  it("carries the agent's language, voice and conversion to the bridge", async () => {
    await claimedAgent();
    const resolution = await resolveDevice(MAC, await testTenant());
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");

    const agent = resolution.body.agent as Record<string, unknown>;
    assert.equal(agent.language, "vietnamese");
    assert.equal(agent.voice, "bryce");
    assert.deepEqual(agent.ovcConfig, { enabled: false });
  });
});

describe("an owner's provider choice", () => {
  async function builtins() {
    return getDb()
      .insert(providerProfiles)
      .values([
        {
          userId: null,
          builtin: true,
          isDefault: true,
          kind: "llm",
          name: "House model",
          baseUrl: "https://llm.example/v1",
          model: "house-model",
          encryptedKey: "",
        },
        {
          userId: null,
          builtin: true,
          isDefault: true,
          kind: "stt",
          name: "House transcriber",
          baseUrl: "http://localhost:8080",
          model: "stt",
          encryptedKey: "",
        },
        {
          userId: null,
          builtin: true,
          isDefault: true,
          kind: "tts",
          name: "House voice",
          baseUrl: "http://localhost:8082",
          model: "tts",
          voice: "house-voice",
          encryptedKey: "",
        },
      ])
      .returning();
  }

  const simpleDraft = (runtimeId: string) => ({
    name: "assistant",
    runtimeId,
    llmProfileId: null,
    sttProfileId: null,
    ttsProfileId: null,
    systemPrompt: "be helpful",
    language: "vietnamese",
    answerMode: "generate",
    topics: [],
  });

  it("refuses an account profile and answers on the deployment's built-ins", async () => {
    const ann = await account("owner@example.com");
    const runtime = await createRuntime({
      name: "interview",
      baseUrl: "http://127.0.0.1:4000",
      token: "runtime-token",
      engines: ["engine-a"],
      languages: ["vietnamese"],
    });
    const validation = validateProviderDraft(draft(), { requireKey: true });
    if (!validation.ok) throw new Error("draft should be valid");
    const ownProfile = await createProviderProfile(ann.id, validation.draft);
    const built = await builtins();

    const refused = await validateAgentDraft(
      { ...simpleDraft(runtime.id), llmProfileId: ownProfile.id },
      ann.id,
      { allowCustomProfiles: false }
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.ok(refused.errors.some((error) => error.includes("not one this account can name")));
    }

    const accepted = await validateAgentDraft(simpleDraft(runtime.id), ann.id, {
      allowCustomProfiles: false,
    });
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(accepted.draft.llmProfileId, built.find((row) => row.kind === "llm")?.id);
    assert.equal(accepted.draft.sttProfileId, built.find((row) => row.kind === "stt")?.id);
    assert.equal(accepted.draft.ttsProfileId, built.find((row) => row.kind === "tts")?.id);
  });
});


describe("Vietnamese speech preference", () => {
  async function speechFixture(options: {
    kind: "stt" | "tts";
    quality: { wer?: number; ttsNaturalness?: number };
    language: "vietnamese" | "english";
  }) {
    const ann = await account("ann@example.com");
    const tenantId = await tenantOfUser(ann.id);
    const issued = await createAdapter(tenantId, {
      name: "acme",
      endpoint: "https://acme.example/v1",
      kinds: [options.kind],
    });
    await getDb()
      .update(providerAdapters)
      .set({ status: "verified", health: "ok", quality: options.quality })
      .where(eq(providerAdapters.id, issued.adapter.id));

    const validation = await validateProviderDraftForUser(
      ann.id,
      {
        kind: options.kind,
        name: "Acme speech",
        adapterId: issued.adapter.id,
        ...(options.kind === "tts" ? { voice: "vi-female-1" } : {}),
      },
      { requireKey: true }
    );
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    const profile = await createProviderProfile(ann.id, validation.draft);

    // The platform's speech provider, which the floor keeps answering.
    const [builtin] = await getDb()
      .insert(providerProfiles)
      .values({
        tenantId: null,
        userId: null,
        builtin: true,
        isDefault: true,
        kind: options.kind,
        name: "platform speech",
        baseUrl: "http://platform.test",
        model: "engine-a",
        voice: options.kind === "tts" ? "platform_voice" : null,
        encryptedKey: "",
      })
      .returning();
    if (builtin === undefined) throw new Error("the platform speech built-in was not stored");

    return { ann, tenantId, profile, issued, builtin };
  }

  it("keeps a below-floor STT adapter off the Vietnamese path, and platform speech answers", async () => {
    const { ann, profile, issued, builtin } = await speechFixture({
      kind: "stt",
      quality: { wer: 0.4 },
      language: "vietnamese",
    });

    const chain = await providerChainForAgent(
      ann.id,
      { stt: profile.id, tts: null, llm: null },
      { language: "vietnamese" }
    );
    assert.deepEqual(chain.stt, [], "below the Vietnamese WER floor");

    const providers = await providersForAgent(
      ann.id,
      { stt: profile.id, tts: null, llm: null }
    );
    assert.ok(providers.stt !== null && providers.stt.path === "openai-compatible");
    if (providers.stt === null || providers.stt.path !== "openai-compatible") return;
    assert.equal(providers.stt.name, builtin.name, "platform speech is the fallback");
    assert.equal(providers.stt.baseUrl, "http://platform.test");
    assert.ok(issued.adapter.id !== providers.stt.name);
  });

  it("lets a verified STT adapter above the floor serve Vietnamese", async () => {
    const { ann, profile, issued } = await speechFixture({
      kind: "stt",
      quality: { wer: 0.1 },
      language: "vietnamese",
    });

    const chain = await providerChainForAgent(
      ann.id,
      { stt: profile.id, tts: null, llm: null },
      { language: "vietnamese" }
    );
    assert.equal(chain.stt.length, 1);
    assert.equal(chain.stt[0]?.adapterId, issued.adapter.id);
  });

  it("keeps a below-floor TTS adapter off the Vietnamese path", async () => {
    const { ann, profile } = await speechFixture({
      kind: "tts",
      quality: { ttsNaturalness: 2.5 },
      language: "vietnamese",
    });

    const chain = await providerChainForAgent(
      ann.id,
      { stt: null, tts: profile.id, llm: null },
      { language: "vietnamese" }
    );
    assert.deepEqual(chain.tts, []);
  });
});

describe("tenant speech built-ins", () => {
  it("refuses a direct speech built-in", async () => {
    const ann = await account("ann@example.com");
    const tenantId = await tenantOfUser(ann.id);

    const direct = await publishTenantBuiltin(tenantId, {
      kind: "tts",
      name: "direct",
      baseUrl: "http://platform.test",
      model: "engine-a",
      voice: "v",
      default: true,
    });
    assert.equal(direct.ok, false);
    if (!direct.ok) {
      assert.ok(direct.errors.some((error) => error.includes("must name a registered adapter")));
    }
  });

  it("refuses a speech built-in naming an adapter of another tenant or the platform", async () => {
    const ann = await account("ann@example.com");
    const tenantId = await tenantOfUser(ann.id);
    const [platformAdapter] = await getDb()
      .insert(providerAdapters)
      .values({
        tenantId: null,
        name: "platform-tts",
        endpoint: "https://platform.example/v1",
        kinds: ["tts"],
        status: "verified",
        health: "ok",
      })
      .returning();

    const foreign = await publishTenantBuiltin(tenantId, {
      kind: "tts",
      name: "foreign",
      adapterId: platformAdapter!.id,
      voice: "v",
      default: true,
    });
    assert.equal(foreign.ok, false);
    if (!foreign.ok) {
      assert.ok(foreign.errors.some((error) => error.includes("registered to this tenant")));
    }
  });

  it("accepts a speech built-in naming an adapter of its tenant", async () => {
    const ann = await account("ann@example.com");
    const tenantId = await tenantOfUser(ann.id);
    const own = await adapter(tenantId, { kinds: ["tts"], name: "own-tts" });

    const published = await publishTenantBuiltin(tenantId, {
      kind: "tts",
      name: "reseller voice",
      adapterId: own.id,
      voice: "v",
      default: true,
    });
    assert.equal(published.ok, true);
    if (!published.ok) return;
    assert.equal((await findProviderProfile(ann.id, published.profile.id))?.adapterId, own.id);
  });

  it("answers local-only speech on the platform built-in even when an account names a direct profile", async () => {
    const ann = await account("ann@example.com");
    const tenantId = await tenantOfUser(ann.id);
    await getDb()
      .insert(providerProfiles)
      .values({
        tenantId: null,
        userId: null,
        builtin: true,
        isDefault: true,
        kind: "tts",
        name: "platform voice",
        baseUrl: "http://platform.test",
        model: "engine-a",
        voice: "pv",
        encryptedKey: "",
      });
    const validation = validateProviderDraft(
      {
        kind: "tts",
        name: "own voice",
        baseUrl: "https://own.example/v1",
        model: "m",
        voice: "ov",
        apiKey: "",
      },
      { requireKey: true }
    );
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    const own = await createProviderProfile(ann.id, validation.draft);
    await getDb()
      .update(tenants)
      .set({ adapterPolicy: { localOnly: true } })
      .where(eq(tenants.id, tenantId));

    const providers = await providersForAgent(
      ann.id,
      { stt: null, tts: own.id, llm: null },
      undefined,
      { allowCustom: true }
    );
    assert.ok(providers.tts !== null && providers.tts.path === "openai-compatible");
    if (providers.tts === null || providers.tts.path !== "openai-compatible") return;
    assert.equal(providers.tts.name, "platform voice");
    assert.equal(providers.tts.baseUrl, "http://platform.test");
  });
});
