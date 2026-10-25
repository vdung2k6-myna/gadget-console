import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agents, llmProfiles } from "@/lib/db/schema";
import { findProfile, storeKey, type ProfileRow } from "@/lib/crypto/profiles";

/**
 * An account's own OpenAI-compatible endpoint.
 *
 * The key is write-only from the browser's side: it is required when a profile is
 * created, and a blank one on edit keeps the stored value. Nothing here ever
 * hands a key back — that is `publicProfile`'s job — and the only reader of the
 * plaintext is the bridge, through the resolve route.
 */

export interface ProfileDraft {
  name: string;
  baseUrl: string;
  model: string;
  temperature: number | null;
  /** Undefined on an edit that keeps the stored key. */
  apiKey?: string;
}

export type ProfileValidation =
  | { ok: true; draft: ProfileDraft }
  | { ok: false; errors: string[] };

export function validateProfileDraft(input: unknown, options: { requireKey: boolean }): ProfileValidation {
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["a profile must be an object"] };
  }
  const body = input as Record<string, unknown>;
  const errors: string[] = [];

  const name = text(body.name);
  if (name === "") errors.push("a name is required");

  const baseUrl = normalizeBaseUrl(text(body.baseUrl));
  if (baseUrl === undefined) errors.push("a base URL is required, and must be an absolute http(s) URL");

  const model = text(body.model);
  if (model === "") errors.push("a model is required");

  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : undefined;
  if (options.requireKey && (apiKey === undefined || apiKey === "")) {
    errors.push("an API key is required");
  }

  let temperature: number | null = null;
  if (body.temperature !== undefined && body.temperature !== null && body.temperature !== "") {
    const value = Number(body.temperature);
    if (!Number.isFinite(value) || value < 0 || value > 2) {
      errors.push("temperature must be between 0 and 2");
    } else {
      temperature = value;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      name,
      baseUrl: baseUrl!,
      model,
      temperature,
      ...(apiKey === undefined || apiKey === "" ? {} : { apiKey }),
    },
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Trailing slashes are dropped, so joining `/chat/completions` is concatenation. */
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

export async function listProfiles(userId: string): Promise<ProfileRow[]> {
  return getDb().select().from(llmProfiles).where(eq(llmProfiles.userId, userId));
}

export async function createProfile(userId: string, draft: ProfileDraft): Promise<ProfileRow> {
  const rows = await getDb()
    .insert(llmProfiles)
    .values({
      userId,
      name: draft.name,
      baseUrl: draft.baseUrl,
      model: draft.model,
      temperature: draft.temperature,
      encryptedKey: storeKey(draft.apiKey ?? ""),
    })
    .returning();
  return rows[0]!;
}

export async function updateProfile(
  userId: string,
  id: string,
  draft: ProfileDraft
): Promise<ProfileRow | undefined> {
  const rows = await getDb()
    .update(llmProfiles)
    .set({
      name: draft.name,
      baseUrl: draft.baseUrl,
      model: draft.model,
      temperature: draft.temperature,
      // A blank key on edit is "keep what is stored", not "store nothing".
      ...(draft.apiKey === undefined ? {} : { encryptedKey: storeKey(draft.apiKey) }),
    })
    .where(and(eq(llmProfiles.id, id), eq(llmProfiles.userId, userId)))
    .returning();
  return rows[0];
}

/** How many agents name this profile — what the delete confirmation says. */
export async function agentsUsing(userId: string, profileId: string): Promise<number> {
  const rows = await getDb()
    .select({ value: count() })
    .from(agents)
    .where(and(eq(agents.userId, userId), eq(agents.llmProfileId, profileId)));
  return Number(rows[0]?.value ?? 0);
}

export async function deleteProfile(userId: string, id: string): Promise<{ deleted: boolean; agentsAffected: number }> {
  const profile = await findProfile(userId, id);
  if (profile === undefined) return { deleted: false, agentsAffected: 0 };
  const agentsAffected = await agentsUsing(userId, id);

  // `agents.llm_profile_id` is `on delete set null`, so this is the whole of the
  // fallback: the agents stay, and are answered by the runtime's default.
  await getDb().delete(llmProfiles).where(and(eq(llmProfiles.id, id), eq(llmProfiles.userId, userId)));
  return { deleted: true, agentsAffected };
}
