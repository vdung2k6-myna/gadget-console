import "dotenv/config";
import { publicRuntime, ensureRuntime } from "../src/lib/runtimes";
import { closeDb } from "../src/lib/db/client";

/**
 * Seeds the runtime an agent points at. Idempotent by name, so running it twice
 * leaves one row rather than two.
 *
 *   RUNTIME_TOKEN=... npm run seed:runtime
 */

async function main(): Promise<void> {
  const name = process.env.RUNTIME_NAME?.trim() || "interview";
  const baseUrl = process.env.RUNTIME_URL?.trim() || "http://127.0.0.1:4000";
  const token = process.env.RUNTIME_TOKEN?.trim();
  const engines = (process.env.RUNTIME_ENGINES ?? "kokoro,piper,supertonic")
    .split(",")
    .map((engine) => engine.trim())
    .filter((engine) => engine !== "");
  const languages = (process.env.RUNTIME_LANGUAGES ?? "english,vietnamese")
    .split(",")
    .map((language) => language.trim())
    .filter((language) => language !== "");

  if (!token) {
    console.error("RUNTIME_TOKEN is required: it is the credential the bridge presents to the runtime");
    process.exitCode = 1;
    return;
  }

  const runtime = await ensureRuntime({ name, baseUrl, token, engines, languages });
  // The public shape, so a seed run never prints a credential into a terminal log.
  console.log(JSON.stringify(publicRuntime(runtime), null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
