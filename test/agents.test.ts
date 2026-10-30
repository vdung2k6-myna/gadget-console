import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import {
  bindDevice,
  createAgent,
  deleteAgent,
  listAgents,
  pairDevices,
  updateAgent,
  validateAgentDraft,
} from "../src/lib/agents";
import { createRuntime } from "../src/lib/runtimes";
import { createProviderProfile } from "../src/lib/provider-profiles";
import { devices } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function account(email: string) {
  const result = await registerAccount(email, "a good password");
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

async function runtime(overrides: Partial<{ engines: string[]; languages: string[] }> = {}) {
  return createRuntime({
    name: "interview",
    baseUrl: "http://127.0.0.1:4000",
    token: "runtime-token",
    engines: overrides.engines ?? ["engine-a", "engine-b"],
    languages: overrides.languages ?? ["english", "vietnamese"],
  });
}

async function device(userId: string, deviceId: string) {
  const rows = await getDb()
    .insert(devices)
    .values({ deviceId, userId, secret: "s".repeat(32) })
    .returning();
  return rows[0]!;
}

function draft(runtimeId: string, overrides: Record<string, unknown> = {}) {
  return {
    name: "assistant",
    runtimeId,
    systemPrompt: "be helpful",
    language: "vietnamese",
    llmProfileId: null,
    sttProfileId: null,
    ttsProfileId: null,
    answerMode: "generate",
    topics: [],
    ...overrides,
  };
}

const MISSING_PROFILE = "00000000-0000-0000-0000-000000000000";

describe("validating an agent", () => {
  it("accepts what the runtime names", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime();
    const result = await validateAgentDraft(draft(rt.id), ann.id);
    assert.equal(result.ok, true);
  });

  it("refuses a language the runtime does not offer", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime({ languages: ["english"] });
    const result = await validateAgentDraft(draft(rt.id, { language: "vietnamese" }), ann.id);
    assert.equal(result.ok, false);
  });

  it("refuses a profile that is not this account's, naming it", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime();
    const result = await validateAgentDraft(draft(rt.id, { ttsProfileId: MISSING_PROFILE }), ann.id);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((error) => error.includes(MISSING_PROFILE)));
  });

  it("refuses a profile of the wrong kind", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime();
    const stt = await createProviderProfile(ann.id, {
      kind: "stt",
      name: "audio.cpp",
      baseUrl: "http://localhost:8080",
      model: "stt",
      voice: null,
      temperature: null,
    });
    const result = await validateAgentDraft(draft(rt.id, { ttsProfileId: stt.id }), ann.id);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((error) => error.includes("not a tts one")));
  });

  it("accepts a profile of the right kind", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime();
    const tts = await createProviderProfile(ann.id, {
      kind: "tts",
      name: "engine-a-vi",
      baseUrl: "http://localhost:8082",
      model: "engine-a",
      voice: "example_voice",
      temperature: null,
    });
    const result = await validateAgentDraft(draft(rt.id, { ttsProfileId: tts.id }), ann.id);
    assert.equal(result.ok, true);
  });

  it("carries a voice of its own, or none", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime();

    const withVoice = await validateAgentDraft(draft(rt.id, { voice: "  tuan_ngoc  " }), ann.id);
    assert.equal(withVoice.ok, true);
    if (withVoice.ok) assert.equal(withVoice.draft.voice, "tuan_ngoc");

    const without = await validateAgentDraft(draft(rt.id, { voice: "   " }), ann.id);
    assert.equal(without.ok, true);
    if (without.ok) assert.equal(without.draft.voice, null, "blank is the provider's own voice");
  });

  it("refuses a missing prompt", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime();
    assert.equal((await validateAgentDraft(draft(rt.id, { systemPrompt: "  " }), ann.id)).ok, false);
  });
});

describe("agents", () => {
  it("creates, lists, edits and deletes an account's own agent", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime();
    const validation = await validateAgentDraft(draft(rt.id), ann.id);
    if (!validation.ok) throw new Error("draft should be valid");

    const agent = await createAgent(ann.id, validation.draft);
    assert.equal((await listAgents(ann.id)).length, 1);

    const edited = await updateAgent(ann.id, agent.id, { ...validation.draft, name: "renamed" });
    assert.equal(edited?.name, "renamed");

    assert.equal(await deleteAgent(ann.id, agent.id), true);
    assert.equal((await listAgents(ann.id)).length, 0);
  });

  it("refuses to edit or delete another account's agent", async () => {
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const rt = await runtime();
    const validation = await validateAgentDraft(draft(rt.id), ann.id);
    if (!validation.ok) throw new Error("draft should be valid");
    const agent = await createAgent(ann.id, validation.draft);

    assert.equal(await updateAgent(bob.id, agent.id, validation.draft), undefined);
    assert.equal(await deleteAgent(bob.id, agent.id), false);
    assert.equal((await listAgents(ann.id)).length, 1);
  });

  it("lets one agent serve two devices", async () => {
    const ann = await account("ann@example.com");
    const rt = await runtime();
    const validation = await validateAgentDraft(draft(rt.id), ann.id);
    if (!validation.ok) throw new Error("draft should be valid");
    const agent = await createAgent(ann.id, validation.draft);

    const one = await device(ann.id, "aa:aa:aa:aa:aa:01");
    const two = await device(ann.id, "aa:aa:aa:aa:aa:02");

    assert.equal((await bindDevice(ann.id, one.id, agent.id)).ok, true);
    assert.equal((await bindDevice(ann.id, two.id, agent.id)).ok, true);
  });

  it("unbinds a device and refuses another account's agent", async () => {
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const rt = await runtime();
    const validation = await validateAgentDraft(draft(rt.id), ann.id);
    if (!validation.ok) throw new Error("draft should be valid");
    const agent = await createAgent(ann.id, validation.draft);
    const one = await device(ann.id, "aa:aa:aa:aa:aa:01");

    assert.deepEqual(await bindDevice(ann.id, one.id, agent.id), {
      ok: true,
      device: { ...one, agentId: agent.id },
    });

    const unbound = await bindDevice(ann.id, one.id, null);
    assert.equal(unbound.ok && unbound.device.agentId, null);

    assert.deepEqual(await bindDevice(bob.id, one.id, agent.id), {
      ok: false,
      reason: "device-not-found",
    });
  });
});

describe("pairing", () => {
  it("pairs two owned devices, on both rows", async () => {
    const ann = await account("ann@example.com");
    const one = await device(ann.id, "aa:aa:aa:aa:aa:01");
    const two = await device(ann.id, "aa:aa:aa:aa:aa:02");

    assert.equal((await pairDevices(ann.id, one.id, two.id)).ok, true);
    const rows = await getDb().select().from(devices);
    const first = rows.find((row) => row.id === one.id)!;
    const second = rows.find((row) => row.id === two.id)!;
    assert.equal(first.partnerDeviceId, two.id);
    assert.equal(second.partnerDeviceId, one.id);
  });

  it("refuses a device as its own partner", async () => {
    const ann = await account("ann@example.com");
    const one = await device(ann.id, "aa:aa:aa:aa:aa:01");
    assert.deepEqual(await pairDevices(ann.id, one.id, one.id), { ok: false, reason: "self" });
  });

  it("refuses a partner another account owns", async () => {
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    const mine = await device(ann.id, "aa:aa:aa:aa:aa:01");
    const theirs = await device(bob.id, "aa:aa:aa:aa:aa:02");

    assert.deepEqual(await pairDevices(ann.id, mine.id, theirs.id), {
      ok: false,
      reason: "partner-not-found",
    });
  });

  it("unpairs, clearing the other side too", async () => {
    const ann = await account("ann@example.com");
    const one = await device(ann.id, "aa:aa:aa:aa:aa:01");
    const two = await device(ann.id, "aa:aa:aa:aa:aa:02");
    await pairDevices(ann.id, one.id, two.id);

    assert.equal((await pairDevices(ann.id, one.id, null)).ok, true);
    const rows = await getDb().select().from(devices);
    assert.equal(rows.find((row) => row.id === two.id)?.partnerDeviceId, null);
  });
});
