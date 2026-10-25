/**
 * The console's one background job: deletion of rows whose time is up.
 *
 * It lives here rather than in a request because no read should pay for cleanup,
 * and rather than in an external scheduler because this deployment has none — the
 * old `prune:turns` script existed for a scheduler that never came. `register()`
 * runs once when the server starts; a deployment that would still rather drive it
 * from outside sets `PRUNE_INTERVAL_MS=0` and calls `npm run prune`.
 */

const BOOT_DELAY_MS = 15_000;

/** Dev reload can evaluate this module more than once; the timer must not multiply. */
let started = false;

export async function register(): Promise<void> {
  // Instrumentation is compiled for every runtime; only the node server owns a database.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (started) return;
  started = true;

  const { loadConfig } = await import("@/lib/config");
  let intervalMs: number;
  try {
    intervalMs = loadConfig().pruneIntervalMs;
  } catch (error) {
    console.error(`[retention] not scheduled: ${message(error)}`);
    return;
  }
  if (intervalMs === 0) {
    console.log("[retention] timer off; run `npm run prune` to clean up");
    return;
  }

  // Imported after the runtime check, so the edge bundle never pulls in Postgres.
  const { pruneAll } = await import("@/lib/retention");

  const run = async (): Promise<void> => {
    try {
      const pruned = await pruneAll();
      console.log(
        `[retention] pruned devices=${pruned.devices} claims=${pruned.claims} turns=${pruned.turns}`
      );
    } catch (error) {
      // A failed pass is a line, not a crash: the next one may succeed, and the
      // console's actual work does not depend on this.
      console.error(`[retention] prune failed: ${message(error)}`);
    }
  };

  // One pass shortly after boot, so a deployment that restarts often still cleans
  // up, then on the stated interval. Both handles are unref'd so they never hold
  // the process open.
  setTimeout(run, BOOT_DELAY_MS).unref();
  setInterval(run, intervalMs).unref();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
