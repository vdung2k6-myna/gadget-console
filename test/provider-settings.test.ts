import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { createRuntime } from "../src/lib/runtimes";
import { agents, providerProfiles } from "../src/lib/db/schema";
import {
  accountSpeechSettings,
  activeAccountProvider,
  providersForAgent,
  saveAccountProvider,
  validateProviderDraft,
} from "../src/lib/provider-profiles";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function account(email = "ann@example.com") {
  const result = await registerAccount(email, "a good password");
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

async function agentFor(userId: string) {
  const runtime = await createRuntime({
    name: "interview",
    baseUrl: "http://127.0.0.1:4000",
    token: "runtime-token",
    engines: ["engine-a"],
    languages: ["vietnamese"],
  });
  const rows = await getDb()
    .insert(agents)
    .values({
      userId,
      runtimeId: runtime.id,
      name: "assistant",
      systemPrompt: "be helpful",
      language: "vietnamese",
      answerMode: "generate",
      topics: [],
    })
    .returning();
  return rows[0]!;
}

function speechDraft(kind: "stt" | "tts", model: string = kind, voice = "") {
  const validation = validateProviderDraft(
    {
      kind,
      name: kind.toUpperCase(),
      baseUrl: "https://speech.example/v1",
      model,
      voice: kind === "tts" ? voice || "some_voice" : "",
      apiKey: "",
    },
    { requireKey: false }
  );
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return validation.draft;
}

describe("the account's speech setting", () => {
  it("creates one row per kind and points the account's agents at it", async () => {
    const ann = await account();
    const agent = await agentFor(ann.id);

    assert.equal(await activeAccountProvider(ann.id, "stt"), undefined);
    const saved = await saveAccountProvider(ann.id, "stt", speechDraft("stt"));

    const stored = await getDb().select().from(agents).where(eq(agents.id, agent.id));
    assert.equal(stored[0]?.sttProfileId, saved.id);

    const settings = await accountSpeechSettings(ann.id);
    assert.equal(settings.stt?.id, saved.id);
    assert.equal(settings.stt?.model, "stt");
    assert.equal(settings.tts, null, "a kind the account has not configured is null, not a default");
  });

  it("edits the same row on a second save rather than adding another", async () => {
    const ann = await account();
    await agentFor(ann.id);

    const first = await saveAccountProvider(ann.id, "tts", speechDraft("tts", "engine-a", "example_voice"));
    const second = await saveAccountProvider(ann.id, "tts", speechDraft("tts", "tts-1", "alloy"));

    const rows = await getDb()
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.userId, ann.id));
    assert.equal(rows.length, 1, "one setting per kind");
    assert.equal(second.id, first.id);
    assert.equal(second.model, "tts-1");
    assert.equal(second.voice, "alloy");
  });

  it("lets an agent's own voice override its tts profile's", async () => {
    const ann = await account();
    await agentFor(ann.id);
    const saved = await saveAccountProvider(ann.id, "tts", speechDraft("tts", "kokoro", "profile_voice"));

    const providers = await providersForAgent(
      ann.id,
      { stt: null, tts: saved.id, llm: null },
      "agent_voice"
    );

    assert.equal(providers.tts?.voice, "agent_voice");
  });

  it("names no provider when the agent has no profile of a kind, whatever voice it sets", async () => {
    const ann = await account();
    await agentFor(ann.id);

    const providers = await providersForAgent(ann.id, { stt: null, tts: null, llm: null }, "agent_voice");

    assert.equal(providers.tts, null, "a voice with no provider has nothing to apply to");
  });
});
