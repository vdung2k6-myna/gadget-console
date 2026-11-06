import { loadConfig } from "@/lib/config";
import { encryptSecret } from "./secret-box";

/**
 * The deployment's key for a provider profile's secret.
 *
 * A key is encrypted at rest and never returned to a browser: the read shape
 * (`publicProviderProfile`) reduces it to “one is set”, and the bridge is the
 * only caller that receives the decrypted value.
 */

export function encryptionKey(): Buffer {
  return Buffer.from(loadConfig().llmKeySecret, "base64");
}

export function storeKey(plaintext: string): string {
  return encryptSecret(plaintext, encryptionKey());
}
