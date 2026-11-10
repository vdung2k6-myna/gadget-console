import "dotenv/config";

import { closeDb } from "../src/lib/db/client";
import { reencryptProviderKeys } from "../src/lib/tenancy/keys";

/**
 * Re-encrypt provider keys under their tenant's data key.
 *
 *   npm run migrate:tenancy-keys -- --dry-run
 *   npm run migrate:tenancy-keys
 *
 * Run it after the pilot backfill has assigned tenants. A row already under its
 * tenant key is skipped; one under the old master key is moved; one that neither
 * key opens is reported as failed.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const report = await reencryptProviderKeys({ dryRun });
  console.log(dryRun ? "dry run — nothing written" : "re-encryption applied");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
