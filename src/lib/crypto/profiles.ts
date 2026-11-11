import { hkdfSync } from "node:crypto";

import { loadConfig } from "@/lib/config";
import { encryptSecret } from "./secret-box";

/**
 * The deployment's master key and the per-tenant keys derived from it.
 *
 * A provider key is encrypted at rest and never returned to a browser. Platform
 * built-ins (`tenant_id = NULL`) use the master key, exactly as the single
 * deployment did; every tenant-scoped row uses a data key derived for its tenant.
 * The data key is derived, so there is no separate key row to delete: deleting the
 * tenant removes every ciphertext encrypted under it, and the derived key then
 * opens nothing. Re-encrypting one tenant never touches another's rows.
 */

const TENANT_SALT = Buffer.from("gadget-console/tenant-keys");

export function encryptionKey(): Buffer {
  return Buffer.from(loadConfig().llmKeySecret, "base64");
}

export function encryptionKeyForTenant(tenantId: string | null): Buffer {
  if (tenantId === null) return encryptionKey();
  return Buffer.from(
    hkdfSync(
      "sha256",
      encryptionKey(),
      TENANT_SALT,
      Buffer.from(`tenant:${tenantId}`),
      32
    )
  );
}

export function storeKey(plaintext: string): string {
  return encryptSecret(plaintext, encryptionKey());
}

export function storeKeyForTenant(tenantId: string | null, plaintext: string): string {
  return encryptSecret(plaintext, encryptionKeyForTenant(tenantId));
}
