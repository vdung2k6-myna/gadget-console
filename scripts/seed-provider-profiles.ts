import "dotenv/config";
import { and, eq, isNull } from "drizzle-orm";

import { closeDb, getDb } from "../src/lib/db/client";
import { providerProfiles } from "../src/lib/db/schema";
import { storeKey } from "../src/lib/crypto/profiles";

/**
 * Publish the providers this deployment configures, and nothing else.
 *
 * The list is the deployment's: `PROVIDER_SEED` is a JSON array of built-ins, so
 * this repository names no engine, voice or address. A deployment that runs no
 * audio services seeds nothing; one that drops them later simply stops naming
 * them. Idempotent by `(builtin, kind, name)` and never deletes a row.
 *
 * An `llm` entry may carry a key. It is encrypted with the console's own secret
 * box, written to the same column an account key uses, and never logged: a
 * built-in model is the deployment's credential, not a value to print.
 *
 *   PROVIDER_SEED='[{"kind":"tts","name":"...","baseUrl":"...","model":"...","voice":"..."}]' \
 *     npm run seed:providers
 */

type Kind = "llm" | "stt" | "tts";

interface SeedEntry {
  kind: Kind;
  name: string;
  baseUrl: string;
  model: string;
  voice?: string;
  /** `llm` only; encrypted before it is stored. */
  apiKey?: string;
  /** `llm` only. */
  temperature?: number;
  default: boolean;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.host !== "";
  } catch {
    return false;
  }
}

function parseSeed(raw: string | undefined): SeedEntry[] {
  if (raw === undefined || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`PROVIDER_SEED must be JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("PROVIDER_SEED must be a JSON array");

  const seen = new Set<string>();
  const defaults = new Set<Kind>();
  return parsed.map((entry: unknown, index: number) => {
    const where = `PROVIDER_SEED[${index}]`;
    if (typeof entry !== "object" || entry === null) throw new Error(`${where} must be an object`);
    const fields = entry as Record<string, unknown>;

    const kind = text(fields.kind);
    if (kind !== "llm" && kind !== "stt" && kind !== "tts") {
      throw new Error(`${where}.kind must be llm, stt or tts`);
    }
    const name = text(fields.name);
    if (name === "") throw new Error(`${where}.name is required`);
    if (seen.has(`${kind}:${name}`)) throw new Error(`${where} repeats ${kind} ${name}`);
    const baseUrl = text(fields.baseUrl).replace(/\/+$/, "");
    if (!isHttpUrl(baseUrl)) throw new Error(`${where}.baseUrl must be an absolute http(s) URL`);
    const model = text(fields.model);
    if (model === "") throw new Error(`${where}.model is required`);

    const voice = text(fields.voice);
    if (kind === "tts" && voice === "") throw new Error(`${where}.voice is required for a tts entry`);
    if (kind !== "tts" && voice !== "") throw new Error(`${where}.voice is only allowed for a tts entry`);

    const apiKey = text(fields.apiKey);
    if (kind !== "llm" && apiKey !== "") {
      throw new Error(`${where}.apiKey is only allowed for an llm entry`);
    }

    let temperature: number | undefined;
    if (fields.temperature !== undefined) {
      if (kind !== "llm") throw new Error(`${where}.temperature is only allowed for an llm entry`);
      const value = fields.temperature;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 2) {
        throw new Error(`${where}.temperature must be a number from 0 to 2`);
      }
      temperature = value;
    }

    const isDefault = fields.default === true;
    if (isDefault) {
      if (defaults.has(kind as Kind)) throw new Error(`${where} is a second default for ${kind}`);
      defaults.add(kind as Kind);
    }

    seen.add(`${kind}:${name}`);
    return {
      kind: kind as Kind,
      name,
      baseUrl,
      model,
      ...(voice === "" ? {} : { voice }),
      ...(apiKey === "" ? {} : { apiKey }),
      ...(temperature === undefined ? {} : { temperature }),
      default: isDefault,
    };
  });
}

/** The key column for this entry: encrypted when named, empty when not. */
function encryptedKeyFor(entry: SeedEntry): string {
  return entry.apiKey === undefined ? "" : storeKey(entry.apiKey);
}

async function ensureBuiltin(entry: SeedEntry): Promise<void> {
  const db = getDb();
  if (entry.default) {
    await db
      .update(providerProfiles)
      .set({ isDefault: false })
      .where(
        and(
          eq(providerProfiles.builtin, true),
          eq(providerProfiles.kind, entry.kind),
          eq(providerProfiles.isDefault, true),
          isNull(providerProfiles.tenantId)
        )
      );
  }

  const existing = await db
    .select({ id: providerProfiles.id })
    .from(providerProfiles)
    .where(
      and(
        eq(providerProfiles.builtin, true),
        eq(providerProfiles.kind, entry.kind),
        eq(providerProfiles.name, entry.name),
        isNull(providerProfiles.tenantId)
      )
    )
    .limit(1);

  if (existing[0] !== undefined) {
    await db
      .update(providerProfiles)
      .set({
        baseUrl: entry.baseUrl,
        model: entry.model,
        voice: entry.voice ?? null,
        temperature: entry.temperature ?? null,
        isDefault: entry.default,
        // An entry that names no key leaves the stored one alone: a re-run must
        // not silently unset the deployment's credential.
        ...(entry.apiKey === undefined ? {} : { encryptedKey: encryptedKeyFor(entry) }),
      })
      .where(eq(providerProfiles.id, existing[0].id));
    return;
  }

  await db.insert(providerProfiles).values({
    tenantId: null,
    userId: null,
    builtin: true,
    isDefault: entry.default,
    kind: entry.kind,
    name: entry.name,
    baseUrl: entry.baseUrl,
    model: entry.model,
    voice: entry.voice ?? null,
    temperature: entry.temperature ?? null,
    encryptedKey: encryptedKeyFor(entry),
  });
  console.log(`seeded ${entry.kind} ${entry.name} (${entry.model})${entry.default ? " — default" : ""}`);
}

async function main(): Promise<void> {
  const entries = parseSeed(process.env.PROVIDER_SEED);
  if (entries.length === 0) {
    console.log("PROVIDER_SEED names no provider — seeded nothing");
    return;
  }
  for (const entry of entries) await ensureBuiltin(entry);
  console.log(`seeded ${entries.length} built-in provider(s)`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
