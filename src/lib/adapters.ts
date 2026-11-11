import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { providerAdapters } from "@/lib/db/schema";
import { encryptionKeyForTenant, storeKeyForTenant } from "@/lib/crypto/profiles";
import { decryptSecret } from "@/lib/crypto/secret-box";

/**
 * The private adapter registry, read and written per tenant.
 *
 * Every accessor takes the caller's tenant and puts it in the predicate; another
 * tenant's adapter answers as one that does not exist. Registration stores the
 * row as pending: no turn routes to it until manifest validation and
 * verification move it to verified.
 */

export const ADAPTER_STATUSES = ["pending", "verified", "disabled"] as const;
export type AdapterStatus = (typeof ADAPTER_STATUSES)[number];
export const ADAPTER_KINDS = ["llm", "stt", "tts"] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export type AdapterRow = typeof providerAdapters.$inferSelect;
/** A row safe to return: the encrypted tokens never leave the console. */
export type AdapterView = Omit<
  AdapterRow,
  "tokenEncrypted" | "previousTokenEncrypted"
>;

export function adapterView(row: AdapterRow): AdapterView {
  const {
    tokenEncrypted: _token,
    previousTokenEncrypted: _previous,
    ...view
  } = row;
  return view;
}

/** The window a rotated token remains acceptable, unless a caller states one. */
export const ADAPTER_TOKEN_OVERLAP_MS = 24 * 60 * 60 * 1000;

function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface IssuedAdapterToken {
  adapter: AdapterView;
  /** Shown once; never stored in plaintext or read back by a route. */
  token: string;
}

/** An opaque `adp_` token, encrypted under this tenant's data key. */
export async function issueAdapterToken(
  tenantId: string,
  id: string
): Promise<IssuedAdapterToken | undefined> {
  const adapter = await getAdapterRow(tenantId, id);
  if (adapter === undefined || adapter.tenantId === null) return undefined;

  const token = `adp_${randomBytes(32).toString("base64url")}`;
  const rows = await getDb()
    .update(providerAdapters)
    .set({
      tokenEncrypted: storeKeyForTenant(tenantId, token),
      tokenHint: `adp_…${token.slice(-4)}`,
      updatedAt: new Date(),
    })
    .where(and(eq(providerAdapters.id, id), eq(providerAdapters.tenantId, tenantId)))
    .returning();
  const updated = rows[0];
  return updated === undefined ? undefined : { adapter: adapterView(updated), token };
}

export interface RotatedAdapterToken extends IssuedAdapterToken {
  previousExpiresAt: Date;
}

/**
 * Rotate the token: the old one remains acceptable until the overlap ends, then
 * only the new one is. Both ciphertexts stay under the tenant key.
 */
export async function rotateAdapterToken(
  tenantId: string,
  id: string,
  options: { overlapMs?: number; now?: Date } = {}
): Promise<RotatedAdapterToken | undefined> {
  const adapter = await getAdapterRow(tenantId, id);
  if (adapter === undefined || adapter.tenantId === null) return undefined;

  const now = options.now ?? new Date();
  const previousExpiresAt = new Date(
    now.getTime() + (options.overlapMs ?? ADAPTER_TOKEN_OVERLAP_MS)
  );
  const token = `adp_${randomBytes(32).toString("base64url")}`;
  const rows = await getDb()
    .update(providerAdapters)
    .set({
      previousTokenEncrypted: adapter.tokenEncrypted,
      previousTokenHint: adapter.tokenHint,
      previousTokenExpiresAt:
        adapter.tokenEncrypted === "" ? null : previousExpiresAt,
      tokenEncrypted: storeKeyForTenant(tenantId, token),
      tokenHint: `adp_…${token.slice(-4)}`,
      updatedAt: now,
    })
    .where(and(eq(providerAdapters.id, id), eq(providerAdapters.tenantId, tenantId)))
    .returning();
  const updated = rows[0];
  return updated === undefined
    ? undefined
    : { adapter: adapterView(updated), token, previousExpiresAt };
}

/** Whether this tenant's adapter accepts the presented plaintext token now. */
export async function verifyAdapterToken(
  tenantId: string,
  id: string,
  token: string,
  options: { now?: Date } = {}
): Promise<boolean> {
  const adapter = await getAdapterRow(tenantId, id);
  if (adapter === undefined || adapter.status === "disabled") return false;
  if (adapter.tokenEncrypted === "") return false;

  const key = encryptionKeyForTenant(tenantId);
  if (sameToken(decryptSecret(adapter.tokenEncrypted, key), token)) return true;

  const now = options.now ?? new Date();
  if (
    adapter.previousTokenEncrypted === "" ||
    adapter.previousTokenExpiresAt === null ||
    adapter.previousTokenExpiresAt.getTime() <= now.getTime()
  ) {
    return false;
  }
  return sameToken(decryptSecret(adapter.previousTokenEncrypted, key), token);
}

export interface AdapterRegistration {
  name: string;
  endpoint: string;
  kinds: AdapterKind[];
  privacy?: Record<string, unknown> | null;
  capabilities?: Record<string, unknown> | null;
  manifestVersion?: string | null;
}

export type AdapterValidation =
  | { ok: true; draft: AdapterRegistration }
  | { ok: false; errors: string[] };

function endpointIsHttps(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "" && url.port === "";
  } catch {
    return false;
  }
}

export function validateAdapterRegistration(input: unknown): AdapterValidation {
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["the body must be an object"] };
  }
  const value = input as Partial<AdapterRegistration>;
  const errors: string[] = [];
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (name === "") errors.push("a name is required");
  const endpoint = typeof value.endpoint === "string" ? value.endpoint.trim() : "";
  if (!endpointIsHttps(endpoint)) errors.push("endpoint must be an https URL on port 443");
  const kinds = Array.isArray(value.kinds)
    ? value.kinds.filter((kind): kind is AdapterKind =>
        (ADAPTER_KINDS as readonly string[]).includes(kind)
      )
    : [];
  if (kinds.length === 0) errors.push("at least one of llm, stt or tts is required");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      name,
      endpoint,
      kinds,
      manifestVersion: value.manifestVersion ?? null,
      // The two jsonb labels are validated by the manifest task; a registration
      // may carry them already.
      privacy: (value.privacy ?? null) as AdapterRegistration["privacy"],
      capabilities: (value.capabilities ?? null) as AdapterRegistration["capabilities"],
    },
  };
}

export async function createAdapter(
  tenantId: string,
  input: AdapterRegistration
): Promise<IssuedAdapterToken> {
  const rows = await getDb()
    .insert(providerAdapters)
    .values({
      tenantId,
      name: input.name,
      endpoint: input.endpoint,
      kinds: input.kinds,
      status: "pending",
      health: "unknown",
      privacy: input.privacy as AdapterRow["privacy"],
      capabilities: input.capabilities as AdapterRow["capabilities"],
      manifestVersion: input.manifestVersion ?? null,
    })
    .returning();
  const issued = await issueAdapterToken(tenantId, rows[0]!.id);
  if (issued === undefined) throw new Error("the adapter token could not be issued");
  return issued;
}

async function getAdapterRow(
  tenantId: string,
  id: string
): Promise<AdapterRow | undefined> {
  const rows = await getDb()
    .select()
    .from(providerAdapters)
    .where(and(eq(providerAdapters.id, id), eq(providerAdapters.tenantId, tenantId)))
    .limit(1);
  return rows[0];
}

export async function listAdapters(tenantId: string): Promise<AdapterView[]> {
  const rows = await getDb()
    .select()
    .from(providerAdapters)
    .where(eq(providerAdapters.tenantId, tenantId))
    .orderBy(asc(providerAdapters.name));
  return rows.map(adapterView);
}

export async function getAdapter(
  tenantId: string,
  id: string
): Promise<AdapterView | undefined> {
  const row = await getAdapterRow(tenantId, id);
  return row === undefined ? undefined : adapterView(row);
}

export async function updateAdapterStatus(
  tenantId: string,
  id: string,
  status: AdapterStatus
): Promise<AdapterView | undefined> {
  const rows = await getDb()
    .update(providerAdapters)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "disabled"
        ? {
            tokenEncrypted: "",
            tokenHint: "",
            previousTokenEncrypted: "",
            previousTokenHint: "",
            previousTokenExpiresAt: null,
          }
        : {}),
    })
    .where(and(eq(providerAdapters.id, id), eq(providerAdapters.tenantId, tenantId)))
    .returning();
  return rows[0] === undefined ? undefined : adapterView(rows[0]);
}

export function disableAdapter(
  tenantId: string,
  id: string
): Promise<AdapterView | undefined> {
  return updateAdapterStatus(tenantId, id, "disabled");
}
