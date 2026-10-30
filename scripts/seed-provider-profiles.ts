import "dotenv/config";
import { and, eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/lib/db/client";
import { providerProfiles } from "../src/lib/db/schema";

/**
 * Publish the providers this deployment configures, and nothing else.
 *
 * The list is the deployment's: `PROVIDER_SEED` is a JSON array of built-ins, so
 * this repository names no audio engine, voice or address. A deployment that
 * runs no audio services seeds nothing; one that drops them later simply stops
 * naming them. Idempotent by `(builtin, kind, name)` and never deletes a row.
 *
 *   PROVIDER_SEED='[{"kind":"tts","name":"...","baseUrl":"...","model":"...","voice":"..."}]' \
 *     npm run seed:providers
 */

type Kind = "stt" | "tts";

interface SeedEntry {
  kind: Kind;
  name: string;
  baseUrl: string;
  model: string;
  voice?: string;
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
    if (kind !== "stt" && kind !== "tts") throw new Error(`${where}.kind must be stt or tts`);
    const name = text(fields.name);
    if (name === "") throw new Error(`${where}.name is required`);
    if (seen.has(`${kind}:${name}`)) throw new Error(`${where} repeats ${kind} ${name}`);
    const baseUrl = text(fields.baseUrl).replace(/\/+$/, "");
    if (!isHttpUrl(baseUrl)) throw new Error(`${where}.baseUrl must be an absolute http(s) URL`);
    const model = text(fields.model);
    if (model === "") throw new Error(`${where}.model is required`);
    const voice = text(fields.voice);
    if (kind === "tts" && voice === "") throw new Error(`${where}.voice is required for a tts entry`);
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
      default: isDefault,
    };
  });
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
          eq(providerProfiles.isDefault, true)
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
        eq(providerProfiles.name, entry.name)
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
        isDefault: entry.default,
      })
      .where(eq(providerProfiles.id, existing[0].id));
    return;
  }

  await db.insert(providerProfiles).values({
    userId: null,
    builtin: true,
    isDefault: entry.default,
    kind: entry.kind,
    name: entry.name,
    baseUrl: entry.baseUrl,
    model: entry.model,
    voice: entry.voice ?? null,
    encryptedKey: "",
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
