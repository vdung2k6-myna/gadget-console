import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { validateAgentDraft, createAgent } from "../src/lib/agents";
import { resolveDevice } from "../src/lib/bridge/registry";
import { resetClaimRateLimit } from "../src/lib/claims";
import { ownDevice as own } from "./helpers/own";
import { publicProfile, readKey, findProfile } from "../src/lib/crypto/profiles";
import {
  agentsUsing,
  createProfile,
  deleteProfile,
  listProfiles,
  updateProfile,
  validateProfileDraft,
} from "../src/lib/llm-profiles";
import { createRuntime } from "../src/lib/runtimes";
import { agents, devices, llmProfiles } from "../src/lib/db/schema";

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
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1/",
    model: "gpt-4o-mini",
    apiKey: "sk-live-abc123",
    temperature: 0.4,
    ...overrides,
  };
}

async function profileFor(userId: string, overrides: Record<string, unknown> = {}) {
  const validation = validateProfileDraft(draft(overrides), { requireKey: true });
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return createProfile(userId, validation.draft);
}

describe("validating a profile", () => {
  it("accepts what an OpenAI-compatible endpoint needs, and drops the trailing slash", () => {
    const result = validateProfileDraft(draft(), { requireKey: true });
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
    ]) {
      assert.equal(validateProfileDraft(draft(bad), { requireKey: true }).ok, false, JSON.stringify(bad));
    }
  });

  it("requires a key when creating, and allows a blank one when editing", () => {
    assert.equal(validateProfileDraft(draft({ apiKey: "" }), { requireKey: true }).ok, false);
    assert.equal(validateProfileDraft(draft({ apiKey: "" }), { requireKey: false }).ok, true);
  });
});

describe("a stored profile", () => {
  it("is listed without its key, and with the key still decryptable", async () => {
    const ann = await account("ann@example.com");
    const created = await profileFor(ann.id);

    const listed = (await listProfiles(ann.id)).map(publicProfile);
    const shown = JSON.stringify(listed);
    assert.equal(shown.includes("sk-live-abc123"), false);
    assert.equal(shown.includes(created.encryptedKey), false);
    assert.equal(listed[0]?.hasKey, true);

    assert.equal(readKey(created), "sk-live-abc123");
  });

  it("keeps its key when an edit leaves the key blank", async () => {
    const ann = await account("ann@example.com");
    const created = await profileFor(ann.id);

    const validation = validateProfileDraft(draft({ apiKey: "", model: "gpt-4o" }), { requireKey: false });
    if (!validation.ok) throw new Error("draft should be valid");
    await updateProfile(ann.id, created.id, validation.draft);

    const stored = await findProfile(ann.id, created.id);
    assert.equal(stored?.model, "gpt-4o");
    assert.equal(readKey(stored!), "sk-live-abc123");
  });

  it("refuses another account's profile for every operation", async () => {
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const created = await profileFor(ann.id);

    assert.equal(await findProfile(bob.id, created.id), undefined);

    const validation = validateProfileDraft(draft(), { requireKey: false });
    if (!validation.ok) throw new Error("draft should be valid");
    assert.equal(await updateProfile(bob.id, created.id, validation.draft), undefined);
    assert.deepEqual(await deleteProfile(bob.id, created.id), { deleted: false, agentsAffected: 0 });
    assert.equal((await listProfiles(bob.id)).length, 0);
  });
});

describe("an agent's profile", () => {
  async function runtime() {
    return createRuntime({
      name: "interview",
      baseUrl: "http://127.0.0.1:4000",
      token: "runtime-token",
      engines: ["kokoro"],
      languages: ["vietnamese"],
    });
  }

  function agentDraft(runtimeId: string, llmProfileId: string | null) {
    return {
      name: "assistant",
      runtimeId,
      llmProfileId,
      systemPrompt: "be helpful",
      language: "vietnamese",
      engine: "kokoro",
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
    assert.ok(foreign.errors.some((error) => error.includes("not one this account owns")));
  });

  it("deleting a profile leaves its agents without one, and says how many", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime();
    const profile = await profileFor(ann.id);

    const validation = await validateAgentDraft(agentDraft(rt.id, profile.id), ann.id);
    if (!validation.ok) throw new Error("draft should be valid");
    const agent = await createAgent(ann.id, validation.draft);

    assert.equal(await agentsUsing(ann.id, profile.id), 1);
    assert.deepEqual(await deleteProfile(ann.id, profile.id), { deleted: true, agentsAffected: 1 });

    const rows = await getDb().select().from(agents).where(eq(agents.id, agent.id));
    assert.equal(rows[0]?.llmProfileId, null);
    assert.equal((await getDb().select().from(llmProfiles)).length, 0);
  });
});

describe("the resolution the bridge receives", () => {
  async function claimedAgent(withProfile: boolean) {
    const ann = await account("ann@example.com");
    const rt = createRuntime({
      name: "interview",
      baseUrl: "http://127.0.0.1:4000",
      token: "runtime-token",
      engines: ["kokoro"],
      languages: ["vietnamese"],
    });
    const runtime = await rt;

    const profile = withProfile ? await profileFor(ann.id) : null;
    const validation = await validateAgentDraft(
      {
        name: "assistant",
        runtimeId: runtime.id,
        llmProfileId: profile?.id ?? null,
        systemPrompt: "be helpful",
        language: "vietnamese",
        engine: "kokoro",
        answerMode: "generate",
        topics: [],
      },
      ann.id
    );
    if (!validation.ok) throw new Error("draft should be valid");
    const agent = await createAgent(ann.id, validation.draft);

    const claimed = await own(ann.id, MAC);
    await getDb().update(devices).set({ agentId: agent.id }).where(eq(devices.id, claimed.id));
    return ann;
  }

  it("carries the profile and its key when the agent names one", async () => {
    await claimedAgent(true);
    const resolution = await resolveDevice(MAC);
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");

    const agent = resolution.body.agent as Record<string, unknown>;
    assert.deepEqual(agent.llm, {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      temperature: 0.4,
      apiKey: "sk-live-abc123",
    });
  });

  it("carries null when the agent names none", async () => {
    await claimedAgent(false);
    const resolution = await resolveDevice(MAC);
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");

    const agent = resolution.body.agent as Record<string, unknown>;
    assert.equal(agent.llm, null);
  });
});
