import { eq } from "drizzle-orm";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { encryptionKey, encryptionKeyForTenant } from "@/lib/crypto/profiles";
import { getDb } from "@/lib/db/client";
import { providerProfiles } from "@/lib/db/schema";

/**
 * Move provider keys from the single-deployment key to their tenant's data key.
 *
 * A row already encrypted under the key its tenant expects is skipped. A row
 * encrypted under the master key — every row written before tenancy — is
 * re-encrypted under the tenant key. A row that neither key opens is reported as
 * failed rather than guessed at; the operator can then look at the row.
 */

export interface ReencryptReport {
  scanned: number;
  reencrypted: number;
  skipped: number;
  failed: number;
}

export async function reencryptProviderKeys({
  dryRun = false,
}: { dryRun?: boolean } = {}): Promise<ReencryptReport> {
  const rows = await getDb()
    .select({
      id: providerProfiles.id,
      tenantId: providerProfiles.tenantId,
      encryptedKey: providerProfiles.encryptedKey,
    })
    .from(providerProfiles);

  const report: ReencryptReport = {
    scanned: rows.length,
    reencrypted: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of rows) {
    if (row.encryptedKey === "") {
      report.skipped += 1;
      continue;
    }

    const target = encryptionKeyForTenant(row.tenantId);
    try {
      decryptSecret(row.encryptedKey, target);
      report.skipped += 1;
      continue;
    } catch {
      // Not under the tenant key; try the master next.
    }

    let plaintext: string;
    try {
      plaintext = decryptSecret(row.encryptedKey, encryptionKey());
    } catch {
      report.failed += 1;
      continue;
    }

    report.reencrypted += 1;
    if (dryRun) continue;

    await getDb()
      .update(providerProfiles)
      .set({ encryptedKey: encryptSecret(plaintext, target) })
      .where(eq(providerProfiles.id, row.id));
  }

  return report;
}
