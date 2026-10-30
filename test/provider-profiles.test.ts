import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
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
  updateProviderProfile,
  validateProviderDraft,
} from "../src/lib/provider-profiles";
import { createRuntime } from "../src/lib/runtimes";
import { agents, devices, providerProfiles } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(async () => {
  await resetDb();
  resetClaimRateLimit();
});
after(closeDb);

const MAC = "B8:1F:3F:4A:9B:01";

async function account(email: string) {
  const result = await registerAccount(email, "a good password");
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
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
    const resolution = await resolveDevice(MAC);
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");

    const agent = resolution.body.agent as Record<string, unknown>;
    assert.deepEqual((agent.providers as Record<string, unknown>).llm, {
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
    const resolution = await resolveDevice(MAC);
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");

    const providers = (resolution.body.agent as Record<string, unknown>).providers as Record<string, unknown>;
    assert.equal(providers.stt, null);
    assert.equal(providers.tts, null);
    assert.notEqual(providers.llm, null, "the answering model is required, so it is always named");
  });
});
