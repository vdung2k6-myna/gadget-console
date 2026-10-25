import { and, eq } from "drizzle-orm";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { llmProfiles } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "./secret-box";

/**
 * A profile as anything but the bridge sees it: the key reduced to "one is set".
 * Every browser response and every log line goes through this shape, so a key
 * has no field to travel in.
 */
export type ProfileRow = typeof llmProfiles.$inferSelect;

export interface PublicProfile {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  temperature: number | null;
  hasKey: true;
  createdAt: Date;
}

export function publicProfile(profile: ProfileRow): PublicProfile {
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    model: profile.model,
    temperature: profile.temperature,
    hasKey: true,
    createdAt: profile.createdAt,
  };
}

/** What the bridge receives: the whole profile, key included, decrypted. */
export interface RuntimeProfile {
  baseUrl: string;
  model: string;
  temperature: number | null;
  apiKey: string;
}

export function encryptionKey(): Buffer {
  return Buffer.from(loadConfig().llmKeySecret, "base64");
}

export function storeKey(plaintext: string): string {
  return encryptSecret(plaintext, encryptionKey());
}

export function readKey(profile: ProfileRow): string {
  return decryptSecret(profile.encryptedKey, encryptionKey());
}

export async function findProfile(userId: string, id: string): Promise<ProfileRow | undefined> {
  const rows = await getDb()
    .select()
    .from(llmProfiles)
    .where(and(eq(llmProfiles.id, id), eq(llmProfiles.userId, userId)))
    .limit(1);
  return rows[0];
}

/** The profile an agent names, if it is the agent's account that owns it. */
export async function profileForAgent(
  userId: string,
  profileId: string | null
): Promise<RuntimeProfile | null> {
  if (profileId === null) return null;
  const profile = await findProfile(userId, profileId);
  if (profile === undefined) return null;
  return {
    baseUrl: profile.baseUrl,
    model: profile.model,
    temperature: profile.temperature,
    apiKey: readKey(profile),
  };
}
