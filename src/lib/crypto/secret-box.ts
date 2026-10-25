import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * An account's LLM key, encrypted at rest.
 *
 * AES-256-GCM with a random IV per encryption and the tag stored beside the
 * ciphertext, written as `v1:<iv>:<tag>:<data>` (base64url). The version prefix
 * is deliberate: changing the key or the algorithm one day becomes a new format
 * rather than a migration of every row, and a stored value that is not `v1` is
 * refused rather than guessed at.
 *
 * The key itself comes from `LLM_KEY_SECRET` and is never stored beside what it
 * encrypts. Losing it makes every profile undecryptable; that is a backup
 * problem, not one this module can solve.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new SecretBoxError(`the encryption key must be 32 bytes, got ${key.length}`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(":");
}

export function decryptSecret(stored: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new SecretBoxError(`the encryption key must be 32 bytes, got ${key.length}`);
  }

  const parts = stored.split(":");
  if (parts.length !== 4) {
    throw new SecretBoxError("the stored value is not in the expected four-part form");
  }
  const [version, ivText, tagText, dataText] = parts;
  if (version !== VERSION) {
    throw new SecretBoxError(`the stored value is version ${JSON.stringify(version)}, not ${VERSION}`);
  }

  const iv = Buffer.from(ivText!, "base64url");
  const tag = Buffer.from(tagText!, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxError("the stored value has a malformed IV or tag");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataText!, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // A tampered ciphertext, a wrong key, and a truncated value all fail here.
    throw new SecretBoxError("the stored value could not be authenticated");
  }
}
