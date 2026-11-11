import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { agents, providerAdapters, providerProfiles, users } from "@/lib/db/schema";
import { encryptionKeyForTenant, storeKeyForTenant } from "@/lib/crypto/profiles";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { resolveAdapterChain } from "@/lib/tenancy/adapters";

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

/**
 * Who may see and select a profile.
 *
 * A platform built-in has no tenant and no owner; every tenant may select it. A
 * tenant built-in belongs to one tenant; its users may select it. An account
 * profile belongs to one account in one tenant.
 */
export type ProviderScope = "platform" | "tenant" | "account";

export function providerScope(
  row: Pick<ProviderProfileRow, "builtin" | "tenantId">
): ProviderScope {
  if (row.builtin) return row.tenantId === null ? "platform" : "tenant";
  return "account";
}

/**
 * A profile is one of two shapes, never both: a direct endpoint and model, or a
 * registered adapter and its opaque config. Nulls say which shape this is.
 */
export interface ProviderProfileDraft {
  kind: ProviderKind;
  name: string;
  /** The direct shape's endpoint; null when the profile names an adapter. */
  baseUrl: string | null;
  /** The direct shape's model; null when the profile names an adapter. */
  model: string | null;
  /** The adapter-backed shape's registry row; null for the direct shape. */
  adapterId?: string | null;
  /** The adapter's opaque config; null for the direct shape. */
  config?: Record<string, unknown> | null;
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
  /** The direct shape's endpoint; null when the profile names an adapter. */
  baseUrl: string | null;
  /** The direct shape's model; null when the profile names an adapter. */
  model: string | null;
  /** The adapter-backed shape's registry row; null for the direct shape. */
  adapterId: string | null;
  /** The adapter's opaque config; null for the direct shape. */
  config: Record<string, unknown> | null;
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
    adapterId: row.adapterId,
    config: row.config,
    voice: row.voice,
    temperature: row.temperature,
    hasKey: row.encryptedKey !== "",
    builtin: row.builtin,
  };
}

/**
 * What the bridge receives: the whole profile, key included, decrypted.
 *
 * One of the two shapes is present. An adapter-backed profile names its registry
 * row and carries no endpoint, model or key: the adapter holds the provider
 * credential and the console calls it through the adapter client.
 */
export interface RuntimeProvider {
  kind: ProviderKind;
  /** The profile's name, which the turn record keeps: an id means nothing later. */
  name: string;
  /** The direct shape only. */
  baseUrl?: string;
  /** The direct shape only. */
  model?: string;
  /** The adapter-backed shape only. */
  adapterId?: string;
  /** The adapter-backed shape only. */
  config?: Record<string, unknown> | null;
  voice?: string;
  apiKey?: string;
  temperature?: number | null;
}

export function runtimeProvider(row: ProviderProfileRow): RuntimeProvider {
  const shared = {
    kind: row.kind as ProviderKind,
    name: row.name,
    ...(row.voice === null ? {} : { voice: row.voice }),
    ...(row.kind === "llm" ? { temperature: row.temperature } : {}),
  };

  if (row.adapterId !== null) {
    // The adapter holds the provider key, so nothing is decrypted here.
    return { ...shared, adapterId: row.adapterId, config: row.config ?? null };
  }

  // `readKey` is typed for the LLM table's non-null owner; a built-in here has
  // no owner at all, so the same box is opened directly.
  const apiKey =
    row.encryptedKey === ""
      ? undefined
      : decryptSecret(row.encryptedKey, encryptionKeyForTenant(row.tenantId));
  return {
    ...shared,
    baseUrl: row.baseUrl ?? "",
    model: row.model ?? "",
    ...(apiKey === undefined ? {} : { apiKey }),
  };
}

/** Whether a runtime provider reaches its adapter rather than a direct endpoint. */
export function isAdapterBacked(
  provider: RuntimeProvider
): provider is RuntimeProvider & { adapterId: string } {
  return provider.adapterId !== undefined;
}

/**
 * A profile resolved for a turn.
 *
 * The two shapes are the two paths the platform speaks. A direct profile is the
 * OpenAI-compatible endpoint the runtime has always called; an adapter-backed
 * profile is the connection an adapter client needs — endpoint, token and
 * opaque config — and nothing else is invented from it.
 */
export interface OpenAiCompatibleTurnProvider {
  path: "openai-compatible";
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  model: string;
  voice?: string;
  apiKey?: string;
  temperature?: number | null;
}

export interface AdapterTurnProvider {
  path: "adapter";
  kind: ProviderKind;
  name: string;
  adapterId: string;
  endpoint: string;
  /** The platform-issued token, decrypted here and nowhere else. */
  token: string;
  /** The tenant the adapter belongs to; null for a platform adapter. */
  tenantId: string | null;
  config: Record<string, unknown> | null;
  voice?: string;
}

export type TurnProvider = OpenAiCompatibleTurnProvider | AdapterTurnProvider;

export function isAdapterTurnProvider(
  provider: TurnProvider
): provider is AdapterTurnProvider {
  return provider.path === "adapter";
}

/**
 * Resolve a stored profile to the path that answers its kind.
 *
 * An adapter-backed profile names a registry row; its endpoint and token come
 * from that row and its config from the profile. The token is decrypted with the
 * key of the tenant the adapter belongs to, which is the key it was sealed under.
 * A profile whose adapter is no longer visible resolves to nothing rather than
 * to a different provider.
 */
export async function resolveTurnProvider(
  row: ProviderProfileRow
): Promise<TurnProvider | null> {
  if (row.adapterId === null) {
    const direct = runtimeProvider(row);
    return {
      path: "openai-compatible",
      kind: direct.kind,
      name: direct.name,
      baseUrl: direct.baseUrl ?? "",
      model: direct.model ?? "",
      ...(direct.voice === undefined ? {} : { voice: direct.voice }),
      ...(direct.apiKey === undefined ? {} : { apiKey: direct.apiKey }),
      ...(row.kind === "llm" ? { temperature: row.temperature } : {}),
    };
  }

  const rows = await getDb()
    .select({
      id: providerAdapters.id,
      tenantId: providerAdapters.tenantId,
      endpoint: providerAdapters.endpoint,
      tokenEncrypted: providerAdapters.tokenEncrypted,
    })
    .from(providerAdapters)
    .where(
      and(
        eq(providerAdapters.id, row.adapterId),
        or(
          ...(row.tenantId === null
            ? []
            : [eq(providerAdapters.tenantId, row.tenantId)]),
          isNull(providerAdapters.tenantId)
        )
      )
    )
    .limit(1);
  const adapter = rows[0];
  if (adapter === undefined) return null;

  const token =
    adapter.tokenEncrypted === ""
      ? ""
      : decryptSecret(
          adapter.tokenEncrypted,
          encryptionKeyForTenant(adapter.tenantId)
        );
  return {
    path: "adapter",
    kind: row.kind as ProviderKind,
    name: row.name,
    adapterId: adapter.id,
    endpoint: adapter.endpoint,
    token,
    tenantId: adapter.tenantId,
    config: row.config ?? null,
    ...(row.voice === null ? {} : { voice: row.voice }),
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

  const adapterId = text(body.adapterId);
  const adapterBacked = adapterId !== "";
  const config = parseConfig(body.config, errors);

  let baseUrl: string | null = null;
  let model: string | null = null;
  if (adapterBacked) {
    // The adapter resolves the endpoint and the model. Naming both shapes at
    // once leaves no way to say which one a turn should use.
    if (text(body.baseUrl) !== "" || text(body.model) !== "") {
      errors.push("a profile names either an adapter or a base URL and model, not both");
    }
  } else {
    const normalized = normalizeBaseUrl(text(body.baseUrl));
    if (normalized === undefined) {
      errors.push("a base URL is required, and must be an absolute http(s) URL");
    } else {
      baseUrl = normalized;
    }

    const modelText = text(body.model);
    if (modelText === "") errors.push("a model is required");
    else model = modelText;

    if (config !== null) errors.push("a config belongs only to an adapter-backed profile");
  }

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
  // none. An adapter holds its own provider key, so an adapter-backed profile
  // neither needs one nor stores one. A blank key on edit keeps what is stored.
  if (
    options.requireKey &&
    !adapterBacked &&
    kind === "llm" &&
    (apiKey === undefined || apiKey === "")
  ) {
    errors.push("an API key is required for an llm profile that names no adapter");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      kind: kind as ProviderKind,
      name,
      baseUrl,
      model,
      adapterId: adapterBacked ? adapterId : null,
      config: adapterBacked ? config : null,
      voice: kind === "tts" ? voice : null,
      temperature: kind === "llm" ? temperature : null,
      ...(adapterBacked || apiKey === undefined || apiKey === ""
        ? {}
        : { apiKey }),
    },
  };
}

/** A config is an opaque JSON object, or absent; anything else is a mistake. */
function parseConfig(
  value: unknown,
  errors: string[]
): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push("config must be an object");
    return null;
  }
  return value as Record<string, unknown>;
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

/**
 * Validate a draft that may name an adapter, against the tenant that will own it.
 *
 * The shape rules are pure; naming an adapter adds one fact only the database
 * knows — that the row is registered to this tenant (or is a platform row) and
 * serves this kind of profile. Another tenant's adapter is answered as one that
 * does not exist, exactly as the registry's own accessors do.
 */
export async function validateProviderDraftForTenant(
  tenantId: string | null,
  input: unknown,
  options: { requireKey: boolean }
): Promise<ProviderProfileValidation> {
  const validation = validateProviderDraft(input, options);
  if (!validation.ok) return validation;
  const adapterId = validation.draft.adapterId;
  if (adapterId === undefined || adapterId === null) return validation;

  if (tenantId === null) {
    return { ok: false, errors: ["an adapter-backed profile belongs to a tenant"] };
  }
  const rows = await getDb()
    .select({ kinds: providerAdapters.kinds })
    .from(providerAdapters)
    .where(
      and(
        eq(providerAdapters.id, adapterId),
        or(
          eq(providerAdapters.tenantId, tenantId),
          isNull(providerAdapters.tenantId)
        )
      )
    )
    .limit(1);
  const adapter = rows[0];
  if (adapter === undefined) {
    return {
      ok: false,
      errors: ["the adapter must be one registered to this tenant"],
    };
  }
  if (!adapter.kinds.includes(validation.draft.kind)) {
    return {
      ok: false,
      errors: [`the adapter does not serve a ${validation.draft.kind} profile`],
    };
  }
  return validation;
}

/** The same check for the tenant this account belongs to. */
export async function validateProviderDraftForUser(
  userId: string,
  input: unknown,
  options: { requireKey: boolean }
): Promise<ProviderProfileValidation> {
  return validateProviderDraftForTenant(await tenantForUser(userId), input, options);
}

/** The tenant a user belongs to; null for a platform admin or a legacy account. */
async function tenantForUser(userId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.tenantId ?? null;
}

/** An adapter a profile may name: the tenant's own, and the platform's. */
export interface SelectableAdapter {
  id: string;
  name: string;
  kinds: string[];
  status: string;
}

/**
 * The adapters this tenant may name in a profile.
 *
 * The registry is private, so a tenant's form offers its own adapters and the
 * platform's, never another tenant's. A pending or disabled adapter is listed
 * rather than hidden: it is registered, and the reason it will not serve a turn
 * is the registry's status, which the form shows in the option.
 */
export async function listSelectableAdapters(
  tenantId: string | null
): Promise<SelectableAdapter[]> {
  return getDb()
    .select({
      id: providerAdapters.id,
      name: providerAdapters.name,
      kinds: providerAdapters.kinds,
      status: providerAdapters.status,
    })
    .from(providerAdapters)
    .where(
      tenantId === null
        ? isNull(providerAdapters.tenantId)
        : or(
            eq(providerAdapters.tenantId, tenantId),
            isNull(providerAdapters.tenantId)
          )
    )
    .orderBy(asc(providerAdapters.name));
}

/** The same list for the tenant this account belongs to. */
export async function selectableAdaptersForUser(
  userId: string
): Promise<SelectableAdapter[]> {
  return listSelectableAdapters(await tenantForUser(userId));
}

/** What this account may see: its own, its tenant's built-ins, and the platform's. */
export async function listProviderProfiles(userId: string): Promise<ProviderProfileRow[]> {
  const tenantId = await tenantForUser(userId);
  if (tenantId === null) {
    return getDb()
      .select()
      .from(providerProfiles)
      .where(or(eq(providerProfiles.userId, userId), eq(providerProfiles.builtin, true)));
  }
  return getDb()
    .select()
    .from(providerProfiles)
    .where(
      or(
        and(eq(providerProfiles.userId, userId), eq(providerProfiles.tenantId, tenantId)),
        and(eq(providerProfiles.builtin, true), eq(providerProfiles.tenantId, tenantId)),
        and(eq(providerProfiles.builtin, true), isNull(providerProfiles.tenantId))
      )
    );
}

/** This tenant's own built-ins, in name order. */
export async function listTenantBuiltins(tenantId: string): Promise<ProviderProfileRow[]> {
  return getDb()
    .select()
    .from(providerProfiles)
    .where(
      and(eq(providerProfiles.tenantId, tenantId), eq(providerProfiles.builtin, true))
    )
    .orderBy(asc(providerProfiles.name));
}

export interface TenantProviderProfileView {
  id: string;
  name: string;
  kind: string;
  /** Null when the profile names an adapter instead of a direct endpoint. */
  baseUrl: string | null;
  /** Null when the profile names an adapter instead of a direct endpoint. */
  model: string | null;
  /** The adapter an adapter-backed profile names; null for the direct shape. */
  adapterId: string | null;
  voice: string | null;
  builtin: boolean;
  isDefault: boolean;
  scope: ProviderScope;
  ownerEmail: string | null;
}

/**
 * Every profile a tenant's accounts may select: the platform built-ins, the
 * tenant built-ins, and the accounts' own. The encrypted key is never selected.
 */
export async function listTenantProviderProfiles(
  tenantId: string
): Promise<TenantProviderProfileView[]> {
  const rows = await getDb()
    .select({
      id: providerProfiles.id,
      name: providerProfiles.name,
      kind: providerProfiles.kind,
      baseUrl: providerProfiles.baseUrl,
      model: providerProfiles.model,
      adapterId: providerProfiles.adapterId,
      voice: providerProfiles.voice,
      builtin: providerProfiles.builtin,
      isDefault: providerProfiles.isDefault,
      tenantId: providerProfiles.tenantId,
      ownerEmail: users.email,
    })
    .from(providerProfiles)
    .leftJoin(users, eq(users.id, providerProfiles.userId))
    .where(
      or(
        eq(providerProfiles.tenantId, tenantId),
        and(isNull(providerProfiles.tenantId), eq(providerProfiles.builtin, true))
      )
    )
    .orderBy(
      asc(providerProfiles.kind),
      desc(providerProfiles.builtin),
      asc(providerProfiles.name)
    );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    baseUrl: row.baseUrl,
    model: row.model,
    adapterId: row.adapterId,
    voice: row.voice,
    builtin: row.builtin,
    isDefault: row.isDefault,
    scope: providerScope(row),
    ownerEmail: row.ownerEmail ?? null,
  }));
}

export async function findTenantBuiltin(
  tenantId: string,
  id: string
): Promise<ProviderProfileRow | undefined> {
  const rows = await getDb()
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.id, id),
        eq(providerProfiles.tenantId, tenantId),
        eq(providerProfiles.builtin, true)
      )
    )
    .limit(1);
  return rows[0];
}

export type PublishTenantBuiltinResult =
  | { ok: true; profile: PublicProviderProfile }
  | { ok: false; errors: string[] };

/**
 * A tenant admin publishes a provider every account in its tenant may select.
 * Names are unique per tenant and kind; a new default clears the previous one
 * for that kind in the same tenant.
 */
export async function publishTenantBuiltin(
  tenantId: string,
  input: unknown
): Promise<PublishTenantBuiltinResult> {
  const validation = await validateProviderDraftForTenant(tenantId, input, {
    requireKey: true,
  });
  if (!validation.ok) return validation;
  const draft = validation.draft;
  const isDefault =
    typeof input === "object" &&
    input !== null &&
    (input as { default?: unknown }).default === true;

  const duplicate = await getDb()
    .select({ id: providerProfiles.id })
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.tenantId, tenantId),
        eq(providerProfiles.builtin, true),
        eq(providerProfiles.kind, draft.kind),
        eq(providerProfiles.name, draft.name)
      )
    )
    .limit(1);
  if (duplicate[0] !== undefined) {
    return { ok: false, errors: ["a built-in with that name already exists"] };
  }

  const rows = await getDb().transaction(async (tx) => {
    if (isDefault) {
      await tx
        .update(providerProfiles)
        .set({ isDefault: false })
        .where(
          and(
            eq(providerProfiles.tenantId, tenantId),
            eq(providerProfiles.builtin, true),
            eq(providerProfiles.kind, draft.kind),
            eq(providerProfiles.isDefault, true)
          )
        );
    }

    return tx
      .insert(providerProfiles)
      .values({
        tenantId,
        userId: null,
        builtin: true,
        isDefault,
        kind: draft.kind,
        name: draft.name,
        baseUrl: draft.baseUrl,
        model: draft.model,
        adapterId: draft.adapterId ?? null,
        config: draft.config ?? null,
        voice: draft.voice,
        temperature: draft.temperature,
        // An adapter-backed profile stores no key: the adapter holds it.
        encryptedKey:
          draft.adapterId !== null && draft.adapterId !== undefined
            ? ""
            : draft.apiKey === undefined
              ? ""
              : storeKeyForTenant(tenantId, draft.apiKey),
      })
      .returning();
  });

  return { ok: true, profile: publicProviderProfile(rows[0]!) };
}

/** A profile this account may name: its own, its tenant built-in, or a platform built-in. */
export async function findProviderProfile(
  userId: string,
  id: string
): Promise<ProviderProfileRow | undefined> {
  const tenantId = await tenantForUser(userId);
  const visible =
    tenantId === null
      ? or(eq(providerProfiles.userId, userId), eq(providerProfiles.builtin, true))
      : or(
          and(eq(providerProfiles.userId, userId), eq(providerProfiles.tenantId, tenantId)),
          and(eq(providerProfiles.builtin, true), eq(providerProfiles.tenantId, tenantId)),
          and(eq(providerProfiles.builtin, true), isNull(providerProfiles.tenantId))
        );

  const rows = await getDb()
    .select()
    .from(providerProfiles)
    .where(and(eq(providerProfiles.id, id), visible))
    .limit(1);
  return rows[0];
}

/** A profile this account may change: its own, never a built-in. */
async function findEditableProfile(
  userId: string,
  id: string
): Promise<ProviderProfileRow | undefined> {
  const tenantId = await tenantForUser(userId);
  const rows = await getDb()
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.id, id),
        eq(providerProfiles.userId, userId),
        eq(providerProfiles.builtin, false),
        ...(tenantId === null ? [] : [eq(providerProfiles.tenantId, tenantId)])
      )
    )
    .limit(1);
  return rows[0];
}

export async function createProviderProfile(
  userId: string,
  draft: ProviderProfileDraft
): Promise<ProviderProfileRow> {
  const tenantId = await tenantForUser(userId);
  const rows = await getDb()
    .insert(providerProfiles)
    .values({
      userId,
      tenantId,
      builtin: false,
      kind: draft.kind,
      name: draft.name,
      baseUrl: draft.baseUrl,
      model: draft.model,
      adapterId: draft.adapterId ?? null,
      config: draft.config ?? null,
      voice: draft.voice,
      temperature: draft.temperature,
      // A provider with no key stores nothing: encrypting an empty string would
      // make every local service report a key as set and send an empty bearer.
      // An adapter-backed profile stores no key at all; the adapter holds it.
      encryptedKey:
        draft.adapterId !== null && draft.adapterId !== undefined
          ? ""
          : draft.apiKey === undefined
            ? ""
            : storeKeyForTenant(tenantId, draft.apiKey),
    })
    .returning();
  return rows[0]!;
}

export async function updateProviderProfile(
  userId: string,
  id: string,
  draft: ProviderProfileDraft
): Promise<ProviderProfileRow | undefined> {
  const tenantId = await tenantForUser(userId);
  const existing = await findEditableProfile(userId, id);
  if (existing === undefined) return undefined;

  const rows = await getDb()
    .update(providerProfiles)
    .set({
      kind: draft.kind,
      name: draft.name,
      baseUrl: draft.baseUrl,
      model: draft.model,
      adapterId: draft.adapterId ?? null,
      config: draft.config ?? null,
      voice: draft.voice,
      temperature: draft.temperature,
      // A blank key on edit is "keep what is stored", not "store nothing"; an
      // adapter-backed profile holds no key, so switching shape drops the one
      // that was stored.
      ...(draft.adapterId !== null && draft.adapterId !== undefined
        ? { encryptedKey: "" }
        : draft.apiKey === undefined
          ? {}
          : { encryptedKey: storeKeyForTenant(tenantId, draft.apiKey) }),
    })
    .where(
      and(
        eq(providerProfiles.id, id),
        eq(providerProfiles.userId, userId),
        ...(tenantId === null ? [] : [eq(providerProfiles.tenantId, tenantId)])
      )
    )
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
  const tenantId = await tenantForUser(userId);
  const profile = await findEditableProfile(userId, id);
  if (profile === undefined) return { deleted: false, agentsAffected: 0 };
  const agentsAffected = await agentsUsingProvider(userId, id);

  // The three agent columns are `on delete set null`, so this is the whole of
  // the fallback: the agents stay and fall to the runtime's default.
  await getDb()
    .delete(providerProfiles)
    .where(
      and(
        eq(providerProfiles.id, id),
        eq(providerProfiles.userId, userId),
        ...(tenantId === null ? [] : [eq(providerProfiles.tenantId, tenantId)])
      )
    );
  return { deleted: true, agentsAffected };
}

/**
 * The three providers an agent names, resolved for the bridge.
 *
 * A direct profile resolves to the OpenAI-compatible path; one that names an
 * adapter resolves to the adapter's endpoint, token and config, which is what an
 * adapter client needs. A profile of the wrong kind is not the agent's to name,
 * and is left out rather than sent as a mismatch the runtime would have to
 * refuse.
 */
export async function providersForAgent(
  userId: string,
  ids: { stt: string | null; tts: string | null; llm: string | null },
  /** The voice this agent speaks in, overriding its `tts` profile's. */
  voice?: string | null,
  /** An owner answers from the deployment's built-ins; an admin may use account profiles. */
  options: { allowCustom?: boolean } = {}
): Promise<{ stt: TurnProvider | null; tts: TurnProvider | null; llm: TurnProvider | null }> {
  const tenantId = await tenantForUser(userId);

  async function one(
    kind: ProviderKind,
    id: string | null,
    voiceOverride?: string | null
  ): Promise<TurnProvider | null> {
    const named = id === null ? undefined : await findProviderProfile(userId, id);
    let row = named !== undefined && named.kind === kind ? named : undefined;
    // An owner answers from the deployment's built-ins, whatever an older agent
    // row still names; an administrator may keep using an account profile.
    if (options.allowCustom === false && (row === undefined || !row.builtin)) {
      row = await defaultProviderProfile(kind, tenantId);
    }
    if (row === undefined) return null;
    const provider = await resolveTurnProvider(row);
    // An adapter-backed profile travels in the adapter chain, not as an
    // OpenAI-compatible provider. Beside it, the platform's speech provider is
    // the fallback: a Vietnamese turn keeps platform speech when the adapter is
    // below the hard floor, and a failed chain still has somewhere to go.
    if (provider === null || provider.path === "adapter") {
      const fallbackProfile = await defaultProviderProfile(kind, tenantId);
      if (fallbackProfile === undefined) return null;
      const fallback = await resolveTurnProvider(fallbackProfile);
      if (fallback === null || fallback.path === "adapter") return null;
      return voiceOverride !== undefined && voiceOverride !== null && voiceOverride !== ""
        ? { ...fallback, voice: voiceOverride }
        : fallback;
    }
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

/**
 * One candidate in a turn's adapter chain.
 *
 * It carries what an adapter call needs — the endpoint, the platform-issued
 * token and the opaque config — and the capabilities the runtime may use to
 * explain a choice. A token here is decrypted for the bridge and never for a
 * browser.
 */
export interface ProviderChainCandidate {
  adapterId: string;
  endpoint: string;
  token: string;
  tenantId: string;
  config: Record<string, unknown> | null;
  capabilities: {
    tools?: boolean;
    languages?: string[];
    streaming?: boolean;
  } | null;
  /** The voice a `tts` turn asks for; the adapter's own when the profile names none. */
  voice?: string;
  timeoutMs: number;
}

/** The design's per-operation timeouts. */
const CHAIN_TIMEOUT_MS: Record<ProviderKind, number> = {
  llm: 30_000,
  stt: 60_000,
  tts: 30_000,
};

/**
 * The ordered adapter chain an agent's kinds may use.
 *
 * A profile that names an adapter puts that adapter first, with the profile's
 * own config; the rest keep the tenant's policy order. Only verified, healthy
 * adapters that belong to this tenant are candidates. A direct profile has no
 * chain — it travels the OpenAI-compatible provider path instead.
 */
/** The Vietnamese hard floor for reseller speech. */
const VI_STT_WER_FLOOR = 0.15;
const VI_TTS_NATURALNESS_FLOOR = 3.0;

function meetsSpeechFloor(
  kind: ProviderKind,
  candidate: {
    quality: { wer?: number; ttsNaturalness?: number } | null;
  }
): boolean {
  if (kind === "stt") {
    return (candidate.quality?.wer ?? Number.POSITIVE_INFINITY) <= VI_STT_WER_FLOOR;
  }
  if (kind === "tts") {
    return (
      (candidate.quality?.ttsNaturalness ?? Number.NEGATIVE_INFINITY) >=
      VI_TTS_NATURALNESS_FLOOR
    );
  }
  return true;
}

export async function providerChainForAgent(
  userId: string,
  ids: { stt: string | null; tts: string | null; llm: string | null },
  options: { allowCustom?: boolean; language?: string } = {}
): Promise<{
  stt: ProviderChainCandidate[];
  tts: ProviderChainCandidate[];
  llm: ProviderChainCandidate[];
}> {
  const tenantId = await tenantForUser(userId);
  if (tenantId === null) return { stt: [], tts: [], llm: [] };
  const tenant = tenantId;

  async function chain(
    kind: ProviderKind,
    id: string | null
  ): Promise<ProviderChainCandidate[]> {
    const named = id === null ? undefined : await findProviderProfile(userId, id);
    let row = named !== undefined && named.kind === kind ? named : undefined;
    if (options.allowCustom === false && (row === undefined || !row.builtin)) {
      row = await defaultProviderProfile(kind, tenantId);
    }
    if (row === undefined || row.adapterId === null) return [];
    const profileRow = row;
    const namedId = profileRow.adapterId;
    if (namedId === null) return [];

    const resolved = await resolveAdapterChain(tenant, kind);
    // For Vietnamese, a reseller speech adapter below the hard floor cannot be
    // the Vietnamese path. Its absence leaves the platform's speech provider
    // (returned beside this chain) answering, which is the preference the floor
    // exists to keep.
    const candidates =
      options.language === "vietnamese" && (kind === "stt" || kind === "tts")
        ? resolved.filter((candidate) => meetsSpeechFloor(kind, candidate))
        : resolved;
    if (!candidates.some((candidate) => candidate.id === namedId)) return [];

    const ordered = [
      ...candidates.filter((candidate) => candidate.id === namedId),
      ...candidates.filter((candidate) => candidate.id !== namedId),
    ];
    const stored = await getDb()
      .select({
        id: providerAdapters.id,
        tenantId: providerAdapters.tenantId,
        tokenEncrypted: providerAdapters.tokenEncrypted,
      })
      .from(providerAdapters)
      .where(inArray(providerAdapters.id, ordered.map((candidate) => candidate.id)));
    const byId = new Map(stored.map((adapter) => [adapter.id, adapter]));

    const chain: ProviderChainCandidate[] = [];
    for (const candidate of ordered) {
      const adapter = byId.get(candidate.id);
      if (adapter === undefined || adapter.tenantId === null) continue;
      chain.push({
        adapterId: candidate.id,
        endpoint: candidate.endpoint,
        token:
          adapter.tokenEncrypted === ""
            ? ""
            : decryptSecret(adapter.tokenEncrypted, encryptionKeyForTenant(adapter.tenantId)),
        tenantId: adapter.tenantId,
        config: candidate.id === namedId ? (profileRow.config ?? null) : null,
        capabilities: candidate.capabilities,
        ...(kind === "tts" && profileRow.voice !== null ? { voice: profileRow.voice } : {}),
        timeoutMs: CHAIN_TIMEOUT_MS[kind],
      });
    }
    return chain;
  }

  return {
    stt: await chain("stt", ids.stt),
    tts: await chain("tts", ids.tts),
    llm: await chain("llm", ids.llm),
  };
}

/* ── The account's speech settings ─────────────────────────────────────── */

/** The two kinds an account configures in place, rather than choosing per agent. */
export const SPEECH_KINDS = ["stt", "tts"] as const;
export type SpeechKind = (typeof SPEECH_KINDS)[number];

function agentSpeechColumn(kind: SpeechKind) {
  return kind === "stt" ? agents.sttProfileId : agents.ttsProfileId;
}

/**
 * The built-in marked as the default for a kind.
 *
 * A tenant's own default wins over the platform's; a tenant with none falls back
 * to the platform default. With no tenant named, only the platform default is
 * considered.
 */
export async function defaultProviderProfile(
  kind: ProviderKind,
  tenantId?: string | null
): Promise<ProviderProfileRow | undefined> {
  if (tenantId !== undefined && tenantId !== null) {
    const tenantDefault = await getDb()
      .select()
      .from(providerProfiles)
      .where(
        and(
          eq(providerProfiles.builtin, true),
          eq(providerProfiles.isDefault, true),
          eq(providerProfiles.kind, kind),
          eq(providerProfiles.tenantId, tenantId)
        )
      )
      .limit(1);
    if (tenantDefault[0] !== undefined) return tenantDefault[0];
  }

  const rows = await getDb()
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.builtin, true),
        eq(providerProfiles.isDefault, true),
        eq(providerProfiles.kind, kind),
        isNull(providerProfiles.tenantId)
      )
    )
    .limit(1);
  return rows[0];
}

/** The default for the tenant this account belongs to. */
export async function defaultProviderProfileFor(
  userId: string,
  kind: ProviderKind
): Promise<ProviderProfileRow | undefined> {
  return defaultProviderProfile(kind, await tenantForUser(userId));
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
  const tenantId = await tenantForUser(userId);
  const own = await getDb()
    .select()
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.userId, userId),
        eq(providerProfiles.kind, kind),
        eq(providerProfiles.builtin, false),
        ...(tenantId === null ? [] : [eq(providerProfiles.tenantId, tenantId)])
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

export type PublicSpeechProfile = PublicProviderProfile & { kind: SpeechKind };

function publicSpeechProfile(row: ProviderProfileRow): PublicSpeechProfile {
  return { ...publicProviderProfile(row), kind: row.kind as SpeechKind };
}

/**
 * The account's two speech settings, as it configured them.
 *
 * There is no second value to fall back to: a kind the account has not configured
 * is null, and a turn that names it fails rather than being answered by a
 * deployment-wide default nobody chose.
 */
export interface AccountSpeechSettings {
  stt: PublicSpeechProfile | null;
  tts: PublicSpeechProfile | null;
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

/** The short sample a settings test and an audition speak when asked for none. */
export const SPEECH_TEST_SAMPLE = "Xin chào, đây là giọng đọc thử.";

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
      body: JSON.stringify({ model, input: SPEECH_TEST_SAMPLE, voice, response_format: "wav" }),
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
  async function setting(kind: SpeechKind): Promise<PublicSpeechProfile | null> {
    const own = await activeAccountProvider(userId, kind);
    return own === undefined ? null : publicSpeechProfile(own);
  }
  return { stt: await setting("stt"), tts: await setting("tts") };
}
