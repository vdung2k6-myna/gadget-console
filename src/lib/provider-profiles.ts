import { and, count, desc, eq, or } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { agents, providerProfiles } from "@/lib/db/schema";
import { encryptionKey, storeKey } from "@/lib/crypto/profiles";
import { decryptSecret } from "@/lib/crypto/secret-box";

/**
 * The endpoints that hear, speak and answer for a gadget.
 *
 * One shape with a `kind`, because the rules are the same for all three: the key
 * is encrypted and never returned, a profile belongs to one account, deleting
 * one leaves its agents on the deployment's default. A built-in profile has no
 * owner and no account may change it.
 */

export const PROVIDER_KINDS = ["llm", "stt", "tts"] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export type ProviderProfileRow = typeof providerProfiles.$inferSelect;

export interface ProviderProfileDraft {
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  model: string;
  /** Required for `tts`, and refused for the other kinds. */
  voice: string | null;
  /** Allowed for `llm` only. */
  temperature: number | null;
  /** Undefined on an edit that keeps the stored key. */
  apiKey?: string;
}

export type ProviderProfileValidation =
  | { ok: true; draft: ProviderProfileDraft }
  | { ok: false; errors: string[] };

export interface PublicProviderProfile {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  model: string;
  voice: string | null;
  temperature: number | null;
  hasKey: boolean;
  builtin: boolean;
}

/** What a browser may see: the key is reduced to whether one is set. */
export function publicProviderProfile(row: ProviderProfileRow): PublicProviderProfile {
  return {
    id: row.id,
    kind: row.kind as ProviderKind,
    name: row.name,
    baseUrl: row.baseUrl,
    model: row.model,
    voice: row.voice,
    temperature: row.temperature,
    hasKey: row.encryptedKey !== "",
    builtin: row.builtin,
  };
}

/** What the bridge receives: the whole profile, key included, decrypted. */
export interface RuntimeProvider {
  kind: ProviderKind;
  /** The profile's name, which the turn record keeps: an id means nothing later. */
  name: string;
  baseUrl: string;
  model: string;
  voice?: string;
  apiKey?: string;
  temperature?: number | null;
}

export function runtimeProvider(row: ProviderProfileRow): RuntimeProvider {
  // `readKey` is typed for the LLM table's non-null owner; a built-in here has
  // no owner at all, so the same box is opened directly.
  const apiKey =
    row.encryptedKey === "" ? undefined : decryptSecret(row.encryptedKey, encryptionKey());
  return {
    kind: row.kind as ProviderKind,
    name: row.name,
    baseUrl: row.baseUrl,
    model: row.model,
    ...(row.voice === null ? {} : { voice: row.voice }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(row.kind === "llm" ? { temperature: row.temperature } : {}),
  };
}

export function validateProviderDraft(
  input: unknown,
  options: { requireKey: boolean }
): ProviderProfileValidation {
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["a provider profile must be an object"] };
  }
  const body = input as Record<string, unknown>;
  const errors: string[] = [];

  const kind = text(body.kind);
  if (!(PROVIDER_KINDS as readonly string[]).includes(kind)) {
    errors.push(`kind must be one of ${PROVIDER_KINDS.join(", ")}`);
  }

  const name = text(body.name);
  if (name === "") errors.push("a name is required");

  const baseUrl = normalizeBaseUrl(text(body.baseUrl));
  if (baseUrl === undefined) {
    errors.push("a base URL is required, and must be an absolute http(s) URL");
  }

  const model = text(body.model);
  if (model === "") errors.push("a model is required");

  const voice = text(body.voice);
  if (kind === "tts" && voice === "") errors.push("a voice is required for a tts profile");
  if (kind !== "tts" && voice !== "") errors.push("a voice belongs only to a tts profile");

  let temperature: number | null = null;
  if (body.temperature !== undefined && body.temperature !== null && body.temperature !== "") {
    if (kind !== "llm") {
      errors.push("a temperature belongs only to an llm profile");
    } else {
      const value = Number(body.temperature);
      if (!Number.isFinite(value) || value < 0 || value > 2) {
        errors.push("temperature must be between 0 and 2");
      } else {
        temperature = value;
      }
    }
  }

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : undefined;
  // A key is the llm profile's own rule, and a local speech service often has
  // none. A blank key on edit keeps what is stored.
  if (options.requireKey && kind === "llm" && (apiKey === undefined || apiKey === "")) {
    errors.push("an API key is required for an llm profile");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      kind: kind as ProviderKind,
      name,
      baseUrl: baseUrl!,
      model,
      voice: kind === "tts" ? voice : null,
      temperature: kind === "llm" ? temperature : null,
      ...(apiKey === undefined || apiKey === "" ? {} : { apiKey }),
    },
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Trailing slashes are dropped, so joining `/v1/audio/speech` is concatenation. */
function normalizeBaseUrl(raw: string): string | undefined {
  if (raw === "") return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.search !== "" || url.hash !== "") return undefined;
  return (url.origin + url.pathname).replace(/\/+$/, "");
}

/** An account's own profiles together with the deployment's built-ins. */
export async function listProviderProfiles(userId: string): Promise<ProviderProfileRow[]> {
  return getDb()
    .select()
    .from(providerProfiles)
    .where(or(eq(providerProfiles.userId, userId), eq(providerProfiles.builtin, true)));
}

/** A profile this account may name: its own, or a built-in. */
export async function findProviderProfile(
  userId: string,
  id: string
): Promise<ProviderProfileRow | undefined> {
  const rows = await getDb()
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.id, id),
        or(eq(providerProfiles.userId, userId), eq(providerProfiles.builtin, true))
      )
    )
    .limit(1);
  return rows[0];
}

/** A profile this account may change: its own, never a built-in. */
async function findEditableProfile(
  userId: string,
  id: string
): Promise<ProviderProfileRow | undefined> {
  const rows = await getDb()
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.id, id),
        eq(providerProfiles.userId, userId),
        eq(providerProfiles.builtin, false)
      )
    )
    .limit(1);
  return rows[0];
}

export async function createProviderProfile(
  userId: string,
  draft: ProviderProfileDraft
): Promise<ProviderProfileRow> {
  const rows = await getDb()
    .insert(providerProfiles)
    .values({
      userId,
      builtin: false,
      kind: draft.kind,
      name: draft.name,
      baseUrl: draft.baseUrl,
      model: draft.model,
      voice: draft.voice,
      temperature: draft.temperature,
      // A provider with no key stores nothing: encrypting an empty string would
      // make every local service report a key as set and send an empty bearer.
      encryptedKey: draft.apiKey === undefined ? "" : storeKey(draft.apiKey),
    })
    .returning();
  return rows[0]!;
}

export async function updateProviderProfile(
  userId: string,
  id: string,
  draft: ProviderProfileDraft
): Promise<ProviderProfileRow | undefined> {
  const existing = await findEditableProfile(userId, id);
  if (existing === undefined) return undefined;

  const rows = await getDb()
    .update(providerProfiles)
    .set({
      kind: draft.kind,
      name: draft.name,
      baseUrl: draft.baseUrl,
      model: draft.model,
      voice: draft.voice,
      temperature: draft.temperature,
      // A blank key on edit is "keep what is stored", not "store nothing".
      ...(draft.apiKey === undefined ? {} : { encryptedKey: storeKey(draft.apiKey) }),
    })
    .where(and(eq(providerProfiles.id, id), eq(providerProfiles.userId, userId)))
    .returning();
  return rows[0];
}

/** How many of this account's agents name this profile — what the confirmation says. */
export async function agentsUsingProvider(
  userId: string,
  profileId: string
): Promise<number> {
  const rows = await getDb()
    .select({ value: count() })
    .from(agents)
    .where(
      and(
        eq(agents.userId, userId),
        or(
          eq(agents.sttProfileId, profileId),
          eq(agents.ttsProfileId, profileId),
          eq(agents.llmProfileId, profileId)
        )
      )
    );
  return Number(rows[0]?.value ?? 0);
}

export async function deleteProviderProfile(
  userId: string,
  id: string
): Promise<{ deleted: boolean; agentsAffected: number }> {
  const profile = await findEditableProfile(userId, id);
  if (profile === undefined) return { deleted: false, agentsAffected: 0 };
  const agentsAffected = await agentsUsingProvider(userId, id);

  // The three agent columns are `on delete set null`, so this is the whole of
  // the fallback: the agents stay and fall to the runtime's default.
  await getDb()
    .delete(providerProfiles)
    .where(and(eq(providerProfiles.id, id), eq(providerProfiles.userId, userId)));
  return { deleted: true, agentsAffected };
}

/**
 * The three providers an agent names, decrypted for the bridge.
 *
 * A profile of the wrong kind is not the agent's to name, and is left out rather
 * than sent as a mismatch the runtime would have to refuse.
 */
export async function providersForAgent(
  userId: string,
  ids: { stt: string | null; tts: string | null; llm: string | null },
  /** The voice this agent speaks in, overriding its `tts` profile's. */
  voice?: string | null
): Promise<{ stt: RuntimeProvider | null; tts: RuntimeProvider | null; llm: RuntimeProvider | null }> {
  async function one(
    kind: ProviderKind,
    id: string | null,
    voiceOverride?: string | null
  ): Promise<RuntimeProvider | null> {
    const row =
      id === null
        ? voiceOverride !== undefined && voiceOverride !== null && voiceOverride !== ""
          ? await defaultProviderProfile(kind)
          : undefined
        : await findProviderProfile(userId, id);
    if (row === undefined || row.kind !== kind) return null;
    const provider = runtimeProvider(row);
    return voiceOverride !== undefined && voiceOverride !== null && voiceOverride !== ""
      ? { ...provider, voice: voiceOverride }
      : provider;
  }

  return {
    stt: await one("stt", ids.stt),
    tts: await one("tts", ids.tts, voice),
    llm: await one("llm", ids.llm),
  };
}

/* ── The account's speech settings ─────────────────────────────────────── */

/** The two kinds an account configures in place, rather than choosing per agent. */
export const SPEECH_KINDS = ["stt", "tts"] as const;
export type SpeechKind = (typeof SPEECH_KINDS)[number];

function agentSpeechColumn(kind: SpeechKind) {
  return kind === "stt" ? agents.sttProfileId : agents.ttsProfileId;
}

/** The built-in a deployment marks as the default for a kind, if it marks one. */
export async function defaultProviderProfile(
  kind: ProviderKind
): Promise<ProviderProfileRow | undefined> {
  const rows = await getDb()
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.builtin, true),
        eq(providerProfiles.isDefault, true),
        eq(providerProfiles.kind, kind)
      )
    )
    .limit(1);
  return rows[0];
}

/**
 * The row an account's speech setting is: the one its agents reference, or the
 * newest it owns.
 *
 * Referencing first is what makes a save edit the configuration the agents
 * actually use, even after several rows of the same kind have accumulated; the
 * newest is the row a previous save created when no agent pointed at it yet.
 */
export async function activeAccountProvider(
  userId: string,
  kind: SpeechKind
): Promise<ProviderProfileRow | undefined> {
  const own = await getDb()
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.userId, userId),
        eq(providerProfiles.kind, kind),
        eq(providerProfiles.builtin, false)
      )
    )
    .orderBy(desc(providerProfiles.createdAt));
  if (own.length === 0) return undefined;

  const referenced = await getDb()
    .select({ id: agentSpeechColumn(kind) })
    .from(agents)
    .where(eq(agents.userId, userId));
  const used = new Set(
    referenced.map((entry) => entry.id).filter((id): id is string => id !== null && id !== undefined)
  );
  return own.find((profile) => used.has(profile.id)) ?? own[0];
}

/**
 * Save the account's setting for a kind and point its agents at it.
 *
 * The agents' columns are kept current here rather than resolved on the turn,
 * so the bridge's request stays exactly what it was.
 */
export async function saveAccountProvider(
  userId: string,
  kind: SpeechKind,
  draft: ProviderProfileDraft
): Promise<ProviderProfileRow> {
  const existing = await activeAccountProvider(userId, kind);
  const row =
    existing === undefined
      ? await createProviderProfile(userId, draft)
      : ((await updateProviderProfile(userId, existing.id, draft)) as ProviderProfileRow);
  await getDb()
    .update(agents)
    .set(kind === "stt" ? { sttProfileId: row.id } : { ttsProfileId: row.id })
    .where(eq(agents.userId, userId));
  return row;
}

/**
 * Drop the account's setting for a kind and let the deployment's default answer.
 *
 * With no default, the agents are left with no profile of that kind, and the
 * runtime's own configured default — never a local address assumed by this console.
 */
export async function useDeploymentDefault(
  userId: string,
  kind: SpeechKind
): Promise<ProviderProfileRow | null> {
  const existing = await activeAccountProvider(userId, kind);
  if (existing !== undefined) await deleteProviderProfile(userId, existing.id);

  const fallback = await defaultProviderProfile(kind);
  await getDb()
    .update(agents)
    .set(kind === "stt" ? { sttProfileId: fallback?.id ?? null } : { ttsProfileId: fallback?.id ?? null })
    .where(eq(agents.userId, userId));
  return fallback ?? null;
}

export type PublicSpeechProfile = PublicProviderProfile & { kind: SpeechKind };

export interface SpeechSetting {
  /** The account's own row, or null when it uses the deployment default. */
  own: PublicSpeechProfile | null;
  /** The deployment's default, or null when it publishes none. */
  default: PublicSpeechProfile | null;
}

function publicSpeechProfile(row: ProviderProfileRow): PublicSpeechProfile {
  return { ...publicProviderProfile(row), kind: row.kind as SpeechKind };
}

export interface AccountSpeechSettings {
  stt: SpeechSetting;
  tts: SpeechSetting;
}

/**
 * Speak a short sample through one endpoint, and nothing else.
 *
 * This is what the settings form's test button calls. It never reaches a
 * deployment audio service, so it works on a deployment that has deleted them
 * all; and it stores nothing, so a failed test leaves the saved setting alone.
 */
export type SpeechTestResult =
  | { ok: true; contentType: string; audio: Buffer }
  | { ok: false; error: string };

const TEST_SAMPLE = "Xin chào, đây là giọng đọc thử.";

export async function testSpeechProvider(input: {
  baseUrl: string;
  model: string;
  voice: string;
  apiKey?: string;
}): Promise<SpeechTestResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl.trim());
  const model = input.model.trim();
  const voice = input.voice.trim();
  if (baseUrl === undefined) {
    return { ok: false, error: "the endpoint must be an absolute http(s) URL" };
  }
  if (model === "" || voice === "") return { ok: false, error: "a model and a voice are required" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.apiKey === undefined || input.apiKey === ""
          ? {}
          : { authorization: `Bearer ${input.apiKey}` }),
      },
      body: JSON.stringify({ model, input: TEST_SAMPLE, voice, response_format: "wav" }),
      signal: controller.signal,
      redirect: "error",
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        error: `the provider answered ${response.status}${detail === "" ? "" : `: ${detail.slice(0, 300)}`}`,
      };
    }
    return {
      ok: true,
      contentType: response.headers.get("content-type") ?? "unknown",
      audio: Buffer.from(await response.arrayBuffer()),
    };
  } catch (error) {
    clearTimeout(timeout);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** What the settings page shows: the account's row and the default, per kind. */
export async function accountSpeechSettings(userId: string): Promise<AccountSpeechSettings> {
  async function setting(kind: SpeechKind): Promise<SpeechSetting> {
    const own = await activeAccountProvider(userId, kind);
    const fallback = await defaultProviderProfile(kind);
    return {
      own: own === undefined ? null : publicSpeechProfile(own),
      default: fallback === undefined ? null : publicSpeechProfile(fallback),
    };
  }
  return { stt: await setting("stt"), tts: await setting("tts") };
}
