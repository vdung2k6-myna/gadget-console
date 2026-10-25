import "dotenv/config";
import { closeDb } from "../src/lib/db/client";
import { pruneAll } from "../src/lib/retention";

/**
 * The scheduled pass, run once by hand.
 *
 * The console runs this itself every `PRUNE_INTERVAL_MS`; this command is how an
 * operator checks what a pass would do, and the only way it happens at all on a
 * deployment that sets that interval to zero.
 */
async function main(): Promise<void> {
  const pruned = await pruneAll();
  console.log(
    `pruned devices=${pruned.devices} claims=${pruned.claims} turns=${pruned.turns}`
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
