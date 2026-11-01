import { existsSync } from "node:fs";
import path from "node:path";

import { DEFAULT_GUARD_MINUTES } from "./config";
import type { OpsContext } from "./context";
import { run } from "./package";
import { ssh } from "./remote";
import { sh } from "./runner";
import { SERVICE_NAMES, SERVICES, resolveRepository } from "./services";
import { probeSpeech } from "./speech";

/**
 * A session is the database, the host and the three services, started in that
 * order and stopped in the reverse. The speech services belong to another
 * machine and are only checked.
 */

function sqlPatchArgv(ctx: OpsContext, policy: "ALWAYS" | "NEVER"): string[] {
  return [
    "gcloud",
    "sql",
    "instances",
    "patch",
    ctx.config.databaseInstance,
    `--activation-policy=${policy}`,
    `--project=${ctx.config.project}`,
    "--quiet",
    // The client's own wait can expire before Cloud SQL finishes a cold start,
    // returning non-zero for an operation that succeeds. The poll below decides.
    "--async",
  ];
}

function vmArgv(ctx: OpsContext, action: "start" | "stop"): string[] {
  return [
    "gcloud",
    "compute",
    "instances",
    action,
    ctx.config.instance,
    `--zone=${ctx.config.zone}`,
    `--project=${ctx.config.project}`,
    "--quiet",
    // The poll for RUNNING/TERMINATED is the wait; the client need not block.
    "--async",
  ];
}

function sqlStateArgv(ctx: OpsContext): string[] {
  return [
    "gcloud",
    "sql",
    "instances",
    "describe",
    ctx.config.databaseInstance,
    `--project=${ctx.config.project}`,
    "--format=value(state)",
  ];
}

function vmStateArgv(ctx: OpsContext): string[] {
  return [
    "gcloud",
    "compute",
    "instances",
    "describe",
    ctx.config.instance,
    `--zone=${ctx.config.zone}`,
    `--project=${ctx.config.project}`,
    "--format=value(status)",
  ];
}

function addressStateArgv(ctx: OpsContext): string[] {
  return [
    "gcloud",
    "compute",
    "addresses",
    "describe",
    ctx.config.address,
    `--region=${ctx.config.region}`,
    `--project=${ctx.config.project}`,
    "--format=value(status)",
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  ctx: OpsContext,
  check: () => Promise<boolean>,
  what: string
): Promise<void> {
  const deadline = Date.now() + ctx.poll.timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(ctx.poll.intervalMs);
  }
  throw new Error(`timed out after ${Math.round(ctx.poll.timeoutMs / 1000)}s waiting for ${what}`);
}

async function readValue(ctx: OpsContext, argv: string[]): Promise<string> {
  const result = await ctx.runner.run({ argv });
  return result.code === 0 ? result.stdout.trim() : "";
}

/**
 * The host is up before its SSH daemon and IAP route are; the first attempt
 * after a start can answer 255. Retry the connection, but treat the script's
 * own `timeout:` as the answer — re-running that loop would only repeat it.
 */
async function waitForRemote(
  ctx: OpsContext,
  script: string
): Promise<{ ok: boolean; detail: string }> {
  const deadline = Date.now() + Math.min(ctx.poll.timeoutMs, 120_000);
  let last = "the host did not answer";
  while (Date.now() < deadline) {
    const result = await ssh(ctx.runner, ctx.config, script);
    if (result.code === 0 && result.stdout.split("\n").includes("ready")) {
      return { ok: true, detail: "" };
    }
    const timedOut = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("timeout:"));
    if (timedOut !== undefined) return { ok: false, detail: timedOut };
    last =
      result.stderr
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .at(-1) ?? `exit ${result.code}`;
    await sleep(Math.min(ctx.poll.intervalMs, 2000));
  }
  return { ok: false, detail: last };
}

/**
 * A policy change is asynchronous and the client may refuse it because another
 * operation is in flight. The poll that follows is what decides whether the
 * resource reached the state the session needs, so a non-zero exit is reported
 * rather than fatal.
 */
async function attempt(ctx: OpsContext, argv: string[], doing: string): Promise<void> {
  const result = await ctx.runner.run({ argv });
  if (result.code === 0) return;
  const detail = result.stderr.trim().split("\n").at(-1) ?? `exit ${result.code}`;
  ctx.log(`${doing} did not return success (${detail}); the state check decides`);
}

/**
 * One remote loop rather than a tunnel per check: it names the unit or the
 * endpoint that never arrived.
 */
export function waitScript(): string {
  const lines = [
    "set -uo pipefail",
    'fail=""',
    "for i in $(seq 1 60); do",
    "  ok=1",
  ];
  for (const name of SERVICE_NAMES) {
    const { unit } = SERVICES[name];
    lines.push(
      `  [ "$(systemctl is-active ${sh(unit)})" = active ] || { ok=0; fail="unit:${unit}"; }`
    );
  }
  for (const name of SERVICE_NAMES) {
    const { healthUrl } = SERVICES[name];
    lines.push(
      `  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 2 ${sh(healthUrl)})" = 200 ] || { ok=0; fail="health:${healthUrl}"; }`
    );
  }
  lines.push(
    '  if [ "$ok" = 1 ]; then echo ready; exit 0; fi',
    "  sleep 2",
    "done",
    'echo "timeout:$fail"',
    "exit 1"
  );
  return lines.join("\n");
}

export function guardScript(): string {
  return [
    "set -uo pipefail",
    `last_turn=$(sudo -n bash -c '. /etc/gadget/console.env; psql "$DATABASE_URL" -tAc "select coalesce(extract(epoch from max(started_at))::bigint, 0) from turns"' 2>/dev/null | tr -d '[:space:]')`,
    "sockets=$(ss -Htn state established '( sport = :8001 )' 2>/dev/null | wc -l | tr -d '[:space:]')",
    'printf "last_turn=%s\\n" "${last_turn:-unknown}"',
    'printf "sockets=%s\\n" "${sockets:-0}"',
  ].join("\n");
}

export interface GuardState {
  lastTurnEpoch: number | null;
  sockets: number;
}

export function parseGuard(stdout: string): GuardState {
  const state: GuardState = { lastTurnEpoch: null, sockets: 0 };
  for (const line of stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key === "last_turn" && value !== "unknown" && value !== "") {
      const epoch = Number(value);
      if (Number.isFinite(epoch) && epoch > 0) state.lastTurnEpoch = epoch;
    } else if (key === "sockets") {
      const sockets = Number(value);
      if (Number.isFinite(sockets)) state.sockets = sockets;
    }
  }
  return state;
}

export function guardReasons(
  state: GuardState,
  guardMinutes: number,
  now: Date
): string[] {
  const reasons: string[] = [];
  if (state.sockets > 0) {
    reasons.push(`a gadget is connected to the bridge (${state.sockets} open socket${state.sockets === 1 ? "" : "s"})`);
  }
  if (
    state.lastTurnEpoch !== null &&
    now.getTime() / 1000 - state.lastTurnEpoch < guardMinutes * 60
  ) {
    reasons.push(`a turn was recorded at ${new Date(state.lastTurnEpoch * 1000).toISOString()}`);
  }
  return reasons;
}

export async function startSession(ctx: OpsContext): Promise<void> {
  const { config } = ctx;
  ctx.log(`starting ${config.databaseInstance}, then ${config.instance}`);

  await attempt(ctx, sqlPatchArgv(ctx, "ALWAYS"), "setting the database policy to ALWAYS");

  if (ctx.dryRun) {
    await run(ctx.runner, sqlStateArgv(ctx), "reading the database state");
    await run(ctx.runner, vmArgv(ctx, "start"), "starting the host");
    await ssh(ctx.runner, config, waitScript());
    ctx.log("dry run: the speech endpoints are not probed");
    return;
  }

  await waitFor(
    ctx,
    async () => (await readValue(ctx, sqlStateArgv(ctx))) === "RUNNABLE",
    "the database to become RUNNABLE"
  );
  ctx.log("database RUNNABLE");

  await attempt(ctx, vmArgv(ctx, "start"), "starting the host");
  await waitFor(
    ctx,
    async () => (await readValue(ctx, vmStateArgv(ctx))) === "RUNNING",
    "the host to become RUNNING"
  );
  ctx.log("host RUNNING");

  const ready = await waitForRemote(ctx, waitScript());
  if (!ready.ok) {
    throw new Error(`the session did not become healthy: ${ready.detail}`);
  }
  ctx.log("every unit and health endpoint answered");

  for (const probe of await probeSpeech(config)) {
    ctx.log(
      probe.ok
        ? `speech ${probe.kind}: reachable`
        : `speech ${probe.kind}: unreachable (${probe.detail}); turns will fail at that call`
    );
  }

  ctx.log("session ready");
}

export async function stopSession(
  ctx: OpsContext,
  options: { force?: boolean } = {}
): Promise<void> {
  const { config } = ctx;
  ctx.log(`checking for activity before stopping ${config.instance}`);

  if (ctx.dryRun) {
    await ssh(ctx.runner, config, guardScript());
    await run(ctx.runner, vmArgv(ctx, "stop"), "stopping the host");
    await run(ctx.runner, sqlPatchArgv(ctx, "NEVER"), "setting the database policy to NEVER");
    await run(ctx.runner, addressStateArgv(ctx), "reading the reserved address");
    return;
  }

  const guard = await ssh(ctx.runner, config, guardScript());
  const reasons = guardReasons(
    parseGuard(guard.stdout),
    config.guardMinutes ?? DEFAULT_GUARD_MINUTES,
    new Date()
  );
  if (reasons.length > 0) {
    if (options.force !== true) {
      throw new Error(`refusing to stop: ${reasons.join("; ")}. Use --force to stop anyway.`);
    }
    ctx.log(`--force: ignoring ${reasons.join("; ")}`);
  }

  await attempt(ctx, vmArgv(ctx, "stop"), "stopping the host");
  await waitFor(
    ctx,
    async () => (await readValue(ctx, vmStateArgv(ctx))) === "TERMINATED",
    "the host to become TERMINATED"
  );
  ctx.log("host TERMINATED");

  await attempt(ctx, sqlPatchArgv(ctx, "NEVER"), "setting the database policy to NEVER");
  ctx.log("database policy NEVER");

  const address = await readValue(ctx, addressStateArgv(ctx));
  ctx.log(
    `stopped: no Compute Engine instance bills; disks and database storage remain, and the reserved address is ${address || "unknown"} and still bills while detached`
  );
}

export function statusScript(): string {
  const lines = ["set -uo pipefail"];
  for (const name of SERVICE_NAMES) {
    const { unit, remoteDir, healthUrl } = SERVICES[name];
    lines.push(
      `printf 'unit:${name}=%s\\n' "$(systemctl is-active ${sh(unit)})"`,
      `printf 'health:${name}=%s\\n' "$(curl -s -o /dev/null -w '%{http_code}' -m 3 ${sh(healthUrl)})"`,
      `printf 'revision:${name}=%s\\n' "$(cat ${sh(`${remoteDir}/current/REVISION`)} 2>/dev/null || echo none)"`,
      `printf 'working:${name}=%s\\n' "$(systemctl show -p WorkingDirectory --value ${sh(unit)})"`
    );
  }
  return lines.join("\n");
}

export async function showStatus(ctx: OpsContext): Promise<void> {
  const { config } = ctx;
  const host = await readValue(ctx, vmStateArgv(ctx));
  const database = await readValue(ctx, sqlStateArgv(ctx));
  const address = await readValue(ctx, addressStateArgv(ctx));

  ctx.log(`host       ${host || "unknown"}`);
  ctx.log(`database   ${database || "unknown"}`);
  ctx.log(`address    ${address || "unknown"}`);

  const remote = await ssh(ctx.runner, config, statusScript());
  const fields = new Map<string, string>();
  for (const line of remote.stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

  for (const name of SERVICE_NAMES) {
    const def = SERVICES[name];
    const unit = fields.get(`unit:${name}`) ?? "unknown";
    const health = fields.get(`health:${name}`) ?? "unknown";
    let revision = "none";
    try {
      const parsed = JSON.parse(fields.get(`revision:${name}`) ?? "") as { commit?: unknown };
      if (typeof parsed.commit === "string") revision = parsed.commit.slice(0, 12);
    } catch {
      // reported as none
    }
    ctx.log(`${def.name.padEnd(10)} ${unit.padEnd(9)} health ${health.padEnd(3)} revision ${revision}`);

    const working = fields.get(`working:${name}`);
    if (working !== undefined && working !== `${def.remoteDir}/current`) {
      ctx.log(`  warning: ${def.unit} runs in ${working}, not ${def.remoteDir}/current`);
    }

    const repo = resolveRepository(config, name);
    if (existsSync(path.join(repo, ".git"))) {
      const head = await ctx.runner.run({
        argv: ["git", "-C", repo, "rev-parse", "HEAD"],
        local: true,
      });
      const local = head.code === 0 ? head.stdout.trim() : "";
      if (local !== "" && revision !== "none" && local.slice(0, 12) !== revision) {
        ctx.log(`  drift: local ${local.slice(0, 12)} differs from deployed ${revision}`);
      }
    }
  }

  for (const probe of await probeSpeech(config, { dryRun: ctx.dryRun, log: ctx.log })) {
    ctx.log(
      probe.ok
        ? `speech ${probe.kind}: reachable`
        : `speech ${probe.kind}: unreachable (${probe.detail}); turns fail at that call`
    );
  }
}
