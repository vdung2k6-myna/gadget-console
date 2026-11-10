import "dotenv/config";

import { closeDb } from "../src/lib/db/client";
import { backfillPilotTenant } from "../src/lib/tenancy/backfill";

/**
 * Move the live pilot into its first tenant.
 *
 *   PLATFORM_ADMIN_EMAILS=<email> PILOT_TENANT_SLUG=pilot \
 *     npm run migrate:tenancy -- --dry-run
 *
 * The dry run prints the row counts and writes nothing. The real run creates the
 * tenant (if needed), assigns every unowned row to it, and maps the configured
 * platform admins. It is safe to run twice.
 */

function emails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== "");
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const report = await backfillPilotTenant(
    {
      tenantName: process.env.PILOT_TENANT_NAME?.trim() || "Pilot",
      tenantSlug: process.env.PILOT_TENANT_SLUG?.trim() || "pilot",
      platformAdminEmails: emails(
        process.env.PLATFORM_ADMIN_EMAILS ?? process.env.PROTECTED_ADMINS
      ),
      consoleDomain: process.env.PILOT_CONSOLE_DOMAIN,
      gatewayDomain: process.env.PILOT_GATEWAY_DOMAIN,
    },
    { dryRun }
  );

  console.log(dryRun ? "dry run — nothing written" : "backfill applied");
  console.log(
    `tenant ${report.tenantSlug}: ${report.tenantCreated ? "created" : "already exists"}`
  );
  console.table(report.tables);
  console.log(`platform admins: ${report.platformAdmins.join(", ")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
