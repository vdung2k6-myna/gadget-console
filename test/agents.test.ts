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
    engines: overrides.engines ?? ["kokoro", "piper"],
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
    engine: "kokoro",
    answerMode: "generate",
    topics: [],
    ...overrides,
  };
}

const VALIDATION_USER = "00000000-0000-0000-0000-000000000000";

describe("validating an agent", () => {
  it("accepts what the runtime names", async () => {
    const rt = await runtime();
    const result = await validateAgentDraft(draft(rt.id), VALIDATION_USER);
    assert.equal(result.ok, true);
  });

  it("refuses an engine the runtime does not offer, naming both", async () => {
    const rt = await runtime({ engines: ["kokoro"] });
    const result = await validateAgentDraft(draft(rt.id, { engine: "supertonic" }), VALIDATION_USER);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((e) => e.includes("supertonic") && e.includes("interview")));
  });

  it("refuses a language the runtime does not offer", async () => {
    const rt = await runtime({ languages: ["english"] });
    const result = await validateAgentDraft(draft(rt.id, { language: "vietnamese" }), VALIDATION_USER);
    assert.equal(result.ok, false);
  });

  it("refuses an engine nobody names, and a missing prompt", async () => {
    const rt = await runtime();
    assert.equal((await validateAgentDraft(draft(rt.id, { engine: "whisper" }), VALIDATION_USER)).ok, false);
    assert.equal((await validateAgentDraft(draft(rt.id, { systemPrompt: "  " }), VALIDATION_USER)).ok, false);
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
