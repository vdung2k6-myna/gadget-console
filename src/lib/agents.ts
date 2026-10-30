import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agents, devices } from "@/lib/db/schema";
import { findProviderProfile, type ProviderKind } from "./provider-profiles";
import { findRuntime, type Runtime } from "./runtimes";

/**
 * An agent is everything a turn needs: the prompt, the language and engine it is
 * heard and spoken in, the topics that scope its knowledge, and the runtime that
 * answers it.
 *
 * The engine and the language are checked against the runtime when the agent is
 * saved, because the runtime folds an unknown value into one of its own rather
 * than refusing it — so this is the only place the mistake is visible.
 */

export const AGENT_LANGUAGES = ["english", "vietnamese"] as const;
export const ANSWER_MODES = ["generate", "material"] as const;

export type Agent = typeof agents.$inferSelect;

export interface AgentDraft {
  name: string;
  runtimeId: string;
  /** The account's own model, or null for the runtime's default. */
  llmProfileId: string | null;
  /** The transcriber, or null for the runtime's default. */
  sttProfileId: string | null;
  /** The voice, or null for the runtime's default. */
  ttsProfileId: string | null;
  /** A voice this agent speaks in, or null to use its `tts` profile's. */
  voice: string | null;
  systemPrompt: string;
  language: string;
  answerMode: string;
  topics: string[];
}

export type AgentValidation =
  | { ok: true; draft: AgentDraft }
  | { ok: false; errors: string[] };

export async function validateAgentDraft(
  input: unknown,
  userId: string
): Promise<AgentValidation> {
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["an agent must be an object"] };
  }
  const body = input as Record<string, unknown>;
  const errors: string[] = [];

  const name = text(body.name);
  if (name === "") errors.push("a name is required");

  const runtimeId = text(body.runtimeId);
  let runtime: Runtime | undefined;
  if (runtimeId === "") {
    errors.push("a runtime is required");
  } else {
    runtime = await findRuntime(runtimeId);
    if (runtime === undefined) errors.push(`runtime ${JSON.stringify(runtimeId)} does not exist`);
  }

  const systemPrompt = text(body.systemPrompt);
  if (systemPrompt === "") errors.push("a system prompt is required");

  const language = text(body.language);
  if (!(AGENT_LANGUAGES as readonly string[]).includes(language)) {
    errors.push(`language ${JSON.stringify(language)} is not one the console names`);
  } else if (runtime !== undefined && !runtime.languages.includes(language)) {
    errors.push(`language ${JSON.stringify(language)} is not one runtime ${JSON.stringify(runtime.name)} offers`);
  }

  // A profile is the agent's account's or a built-in, and it has to be the kind
  // the agent is binding it for: an `stt` profile cannot speak, and another
  // account's profile would spend that account's key.
  async function profileOf(
    kind: ProviderKind,
    raw: unknown,
    label: string
  ): Promise<string | null> {
    const id = text(raw);
    if (id === "") return null;
    const profile = await findProviderProfile(userId, id);
    if (profile === undefined) {
      errors.push(`${label} ${JSON.stringify(id)} is not one this account can name`);
      return null;
    }
    if (profile.kind !== kind) {
      errors.push(`${label} ${JSON.stringify(id)} is a ${profile.kind} profile, not a ${kind} one`);
      return null;
    }
    return id;
  }

  // The answering model is required: there is no deployment default to answer a
  // turn that names none, so an agent without one is one that cannot speak.
  const llmProfileId = await profileOf("llm", body.llmProfileId, "the LLM profile");
  if (llmProfileId === null && !errors.some((error) => error.startsWith("the LLM profile"))) {
    errors.push("an answering model is required");
  }
  const sttProfileId = await profileOf("stt", body.sttProfileId, "the STT profile");
  const ttsProfileId = await profileOf("tts", body.ttsProfileId, "the TTS profile");

  // A voice this agent overrides its `tts` profile's with. Free text: this route
  // cannot know what an arbitrary provider holds, so the form checks it against
  // the provider itself (`/api/agents/voice-check`) and the turn reports a
  // refusal naming it.
  const voice = text(body.voice);

  const answerMode = text(body.answerMode) === "" ? "generate" : text(body.answerMode);
  if (!(ANSWER_MODES as readonly string[]).includes(answerMode)) {
    errors.push(`answer mode ${JSON.stringify(answerMode)} is not one the console names`);
  }

  const topics = Array.isArray(body.topics)
    ? body.topics.filter((topic): topic is string => typeof topic === "string").map((topic) => topic.trim()).filter((topic) => topic !== "")
    : [];

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      name,
      runtimeId,
      llmProfileId,
      sttProfileId,
      ttsProfileId,
      voice: voice === "" ? null : voice,
      systemPrompt,
      language,
      answerMode,
      topics,
    },
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function createAgent(userId: string, draft: AgentDraft): Promise<Agent> {
  const rows = await getDb()
    .insert(agents)
    .values({ userId, ...draft })
    .returning();
  return rows[0]!;
}

export async function listAgents(userId: string): Promise<Agent[]> {
  return getDb().select().from(agents).where(eq(agents.userId, userId));
}

export async function updateAgent(
  userId: string,
  agentId: string,
  draft: AgentDraft
): Promise<Agent | undefined> {
  const rows = await getDb()
    .update(agents)
    .set(draft)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    .returning();
  return rows[0];
}

/** Deleting an agent unbinds every device it served (`onDelete: set null`). */
export async function deleteAgent(userId: string, agentId: string): Promise<boolean> {
  const rows = await getDb()
    .delete(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    .returning();
  return rows.length > 0;
}

export type BindResult =
  | { ok: true; device: typeof devices.$inferSelect }
  | { ok: false; reason: "device-not-found" | "agent-not-found" };

export async function bindDevice(
  userId: string,
  deviceRowId: string,
  agentId: string | null
): Promise<BindResult> {
  const device = await ownedDevice(userId, deviceRowId);
  if (device === undefined) return { ok: false, reason: "device-not-found" };

  if (agentId !== null) {
    const agent = await getDb()
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
      .limit(1);
    if (agent[0] === undefined) return { ok: false, reason: "agent-not-found" };
  }

  const rows = await getDb()
    .update(devices)
    .set({ agentId })
    .where(eq(devices.id, deviceRowId))
    .returning();
  return { ok: true, device: rows[0]! };
}

export type PairResult =
  | { ok: true; device: typeof devices.$inferSelect }
  | { ok: false; reason: "device-not-found" | "partner-not-found" | "self" };

/**
 * Pairing is stored on both rows, and the previous partner's back-reference is
 * cleared, so a device has at most one partner and the relation reads the same
 * from either side.
 */
export async function pairDevices(
  userId: string,
  deviceRowId: string,
  partnerRowId: string | null
): Promise<PairResult> {
  const device = await ownedDevice(userId, deviceRowId);
  if (device === undefined) return { ok: false, reason: "device-not-found" };

  if (partnerRowId === null) {
    await releasePartner(deviceRowId, device.partnerDeviceId);
    return { ok: true, device: (await ownedDevice(userId, deviceRowId))! };
  }

  if (partnerRowId === deviceRowId) return { ok: false, reason: "self" };
  const partner = await ownedDevice(userId, partnerRowId);
  if (partner === undefined) return { ok: false, reason: "partner-not-found" };

  await getDb().transaction(async (tx) => {
    await tx
      .update(devices)
      .set({ partnerDeviceId: null })
      .where(and(ne(devices.id, deviceRowId), ne(devices.id, partnerRowId), eq(devices.partnerDeviceId, deviceRowId)));
    await tx
      .update(devices)
      .set({ partnerDeviceId: null })
      .where(and(ne(devices.id, deviceRowId), ne(devices.id, partnerRowId), eq(devices.partnerDeviceId, partnerRowId)));

    await tx.update(devices).set({ partnerDeviceId: partnerRowId }).where(eq(devices.id, deviceRowId));
    await tx.update(devices).set({ partnerDeviceId: deviceRowId }).where(eq(devices.id, partnerRowId));
  });

  return { ok: true, device: (await ownedDevice(userId, deviceRowId))! };
}

async function releasePartner(deviceRowId: string, partnerRowId: string | null): Promise<void> {
  await getDb().transaction(async (tx) => {
    if (partnerRowId !== null) {
      await tx
        .update(devices)
        .set({ partnerDeviceId: null })
        .where(and(eq(devices.id, partnerRowId), eq(devices.partnerDeviceId, deviceRowId)));
    }
    await tx.update(devices).set({ partnerDeviceId: null }).where(eq(devices.id, deviceRowId));
  });
}

async function ownedDevice(userId: string, deviceRowId: string) {
  const rows = await getDb()
    .select()
    .from(devices)
    .where(and(eq(devices.id, deviceRowId), eq(devices.userId, userId)))
    .limit(1);
  return rows[0];
}
