import path from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_CONFIG_FILE, loadOpsConfig } from "./ops/config";
import type { OpsContext } from "./ops/context";
import { deploy } from "./ops/deploy";
import { DryRunRunner, ExecRunner } from "./ops/runner";
import { parseServiceName } from "./ops/services";
import { showStatus, startSession, stopSession } from "./ops/session";

/**
 * The operator's tool: deploy a service, start or stop a session, inspect what
 * is running. It runs from this checkout over IAP; the host holds no credential.
 *
 *   npm run ops -- status
 *   npm run ops -- deploy console --migrate
 *   npm run ops -- session stop
 */
export const HELP = `usage: npm run ops -- <command> [options]

  status
      Report the host, the database, the services and their revisions.

  deploy <console|bridge|runtime> [--migrate] [--rollback]
      Ship a committed revision, build it, switch the release and verify it.
      --migrate applies to the console only; --rollback returns to the release
      that was serving before the current one.

  session start
      Start Cloud SQL, then the host, and wait for every service.

  session stop [--force]
      Refuse while a gadget is connected or a turn is recent, then stop the
      host and the database.

options:
  --dry-run          print the commands instead of performing them
  --config <path>    operator configuration (default: ${DEFAULT_CONFIG_FILE})
  --help             this text`;

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function main(argv: string[]): Promise<number> {
  const flags = new Set<string>();
  const positional: string[] = [];
  let configPath = DEFAULT_CONFIG_FILE;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--config") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--config needs a path");
      configPath = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      console.log(HELP);
      return 0;
    } else if (argument.startsWith("--")) {
      flags.add(argument);
    } else {
      positional.push(argument);
    }
  }

  if (positional.length === 0) {
    console.log(HELP);
    return 1;
  }

  const config = await loadOpsConfig(configPath);
  const dryRun = flags.has("--dry-run");
  const runner = dryRun
    ? new DryRunRunner(new ExecRunner(), (line) => console.log(line))
    : new ExecRunner();
  const context: OpsContext = {
    runner,
    config,
    configPath: path.resolve(configPath),
    dryRun,
    log: (line) => console.log(line),
    poll: {
      timeoutMs: numberFromEnv("OPS_POLL_TIMEOUT_MS", 15 * 60_000),
      intervalMs: numberFromEnv("OPS_POLL_INTERVAL_MS", 5_000),
    },
  };

  const [verb, ...rest] = positional;
  if (verb === "status") {
    await showStatus(context);
    return 0;
  }
  if (verb === "deploy") {
    const service = parseServiceName(rest[0] ?? "");
    await deploy(context, service, {
      migrate: flags.has("--migrate"),
      rollback: flags.has("--rollback"),
    });
    return 0;
  }
  if (verb === "session") {
    const action = rest[0];
    if (action === "start") {
      await startSession(context);
      return 0;
    }
    if (action === "stop") {
      await stopSession(context, { force: flags.has("--force") });
      return 0;
    }
    throw new Error("usage: npm run ops -- session <start|stop>");
  }

  throw new Error(`unknown command ${JSON.stringify(verb)}\n\n${HELP}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
