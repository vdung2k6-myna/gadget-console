import { sh } from "./runner";

/**
 * The remote shell snippets a deploy sends, one act each, so the order is
 * visible and each is testable on its own.
 */
export function releasePath(remoteDir: string, commit: string): string {
  return `${remoteDir}/releases/${commit}`;
}

export function prepareScript(remoteDir: string, commit: string, tarball: string): string {
  const release = releasePath(remoteDir, commit);
  return [
    "set -euo pipefail",
    `mkdir -p ${sh(`${remoteDir}/releases`)}`,
    `rm -rf ${sh(release)}`,
    `mkdir -p ${sh(release)}`,
    `tar xzf ${sh(tarball)} -C ${sh(release)}`,
  ].join("\n");
}

/**
 * Dependencies come from the release that is serving when its lockfile is
 * identical, as hard links inside the same filesystem; otherwise they are
 * installed. A release therefore always has its own node_modules.
 */
export function installScript(remoteDir: string, commit: string): string {
  const release = releasePath(remoteDir, commit);
  return [
    "set -euo pipefail",
    `cd ${sh(release)}`,
    "lock=$(sha256sum package-lock.json | cut -d' ' -f1)",
    `prev=$(readlink -f ${sh(`${remoteDir}/current`)} || true)`,
    'if [ -n "$prev" ] && [ -f "$prev/node_modules/.lock-hash" ] && [ "$(cat "$prev/node_modules/.lock-hash")" = "$lock" ]; then',
    '  cp -al "$prev/node_modules" node_modules',
    "else",
    "  npm ci",
    '  printf "%s\\n" "$lock" > node_modules/.lock-hash',
    "fi",
  ].join("\n");
}

export function buildScript(remoteDir: string, commit: string, build: string[]): string {
  return [
    "set -euo pipefail",
    `cd ${sh(releasePath(remoteDir, commit))}`,
    build.map(sh).join(" "),
  ].join("\n");
}

export function migrateScript(remoteDir: string, commit: string): string {
  return [
    "set -euo pipefail",
    `sudo bash -c "set -a; . /etc/gadget/console.env; set +a; cd ${sh(releasePath(remoteDir, commit))} && npx drizzle-kit migrate"`,
  ].join("\n");
}

/** Both switches use the same rename, so `current` is never a missing path. */
export function switchToScript(remoteDir: string, target: string): string {
  return [
    "set -euo pipefail",
    `ln -sfn ${sh(target)} ${sh(`${remoteDir}/current.next`)}`,
    `mv -T ${sh(`${remoteDir}/current.next`)} ${sh(`${remoteDir}/current`)}`,
  ].join("\n");
}

export function linkScript(remoteDir: string, commit: string): string {
  return switchToScript(remoteDir, releasePath(remoteDir, commit));
}

export function restartScript(unit: string): string {
  return ["set -euo pipefail", `sudo systemctl restart ${sh(unit)}`, "date +%s"].join("\n");
}

export function pruneScript(remoteDir: string, keep: number): string {
  return [
    "set -euo pipefail",
    `cd ${sh(`${remoteDir}/releases`)}`,
    `ls -1dt */ 2>/dev/null | tail -n +${keep + 1} | xargs -r rm -rf --`,
  ].join("\n");
}

export function verifyScript(remoteDir: string, unit: string, healthUrl: string): string {
  const release = `${remoteDir}/current`;
  return [
    "set -euo pipefail",
    `release=${sh(release)}`,
    `printf 'revision=%s\\n' "$(cat "$release/REVISION")"`,
    `printf 'working_directory=%s\\n' "$(systemctl show -p WorkingDirectory --value ${sh(unit)})"`,
    `printf 'active_enter_epoch=%s\\n' "$(date -d "$(systemctl show -p ActiveEnterTimestamp --value ${sh(unit)})" +%s 2>/dev/null || echo 0)"`,
    `printf 'health=%s\\n' "$(curl -s -o /dev/null -w '%{http_code}' -m 5 ${sh(healthUrl)})"`,
  ].join("\n");
}

export interface DeploymentReport {
  revision?: string;
  workingDirectory?: string;
  activeEnterEpoch?: number;
  health?: string;
}

export function parseReport(stdout: string): DeploymentReport {
  const report: DeploymentReport = {};
  for (const line of stdout.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const key = line.slice(0, at);
    const value = line.slice(at + 1);
    if (key === "revision") report.revision = value;
    else if (key === "working_directory") report.workingDirectory = value;
    else if (key === "active_enter_epoch") report.activeEnterEpoch = Number(value);
    else if (key === "health") report.health = value;
  }
  return report;
}

/**
 * The health endpoint is not proof: a failed build leaves the previous release
 * answering it. These are the signals that the shipped revision is what serves.
 */
export function verifyDeployment(
  report: DeploymentReport,
  expected: { commit: string; remoteDir: string; switchedAtEpoch: number }
): string[] {
  const errors: string[] = [];

  let commit = "";
  try {
    const revision = JSON.parse(report.revision ?? "") as { commit?: unknown };
    if (typeof revision.commit === "string") commit = revision.commit;
  } catch {
    // reported below
  }
  if (commit !== expected.commit) {
    errors.push(
      `the host reports revision ${commit === "" ? "(none)" : commit}, but ${expected.commit} was shipped`
    );
  }

  const expectedWorkingDirectory = `${expected.remoteDir}/current`;
  if (report.workingDirectory !== expectedWorkingDirectory) {
    errors.push(
      `the unit's WorkingDirectory is ${report.workingDirectory ?? "(unknown)"}, not ${expectedWorkingDirectory}`
    );
  }

  const entered = report.activeEnterEpoch;
  if (typeof entered !== "number" || !(entered >= expected.switchedAtEpoch - 60)) {
    errors.push(
      `the unit did not restart after the release: ActiveEnterTimestamp is ${Number.isFinite(entered) ? `${entered}` : "(unknown)"}, before the switch at ${expected.switchedAtEpoch}`
    );
  }

  if (report.health !== "200") {
    errors.push(`health answered ${report.health ?? "(nothing)"}, not 200`);
  }

  return errors;
}
