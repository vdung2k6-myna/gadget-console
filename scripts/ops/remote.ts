import type { OpsConfig } from "./config";
import { sh, type CommandResult, type Runner } from "./runner";

/**
 * One host, reached only through IAP with the operator's own identity. The
 * host holds no repository and no credential for one.
 *
 * `asUser` runs the script as the account the units run as. The operator's SSH
 * login need not be that account, and the trees under `/srv` are owned by it.
 */
export function ssh(
  runner: Runner,
  config: OpsConfig,
  script: string,
  options: { asUser?: string } = {}
): Promise<CommandResult> {
  const command =
    options.asUser === undefined
      ? script
      : `sudo -u ${sh(options.asUser)} -H bash -c ${sh(script)}`;
  return runner.run({
    argv: [
      "gcloud",
      "compute",
      "ssh",
      config.instance,
      `--zone=${config.zone}`,
      `--project=${config.project}`,
      "--tunnel-through-iap",
      "--quiet",
      `--command=${command}`,
    ],
  });
}

export function scp(
  runner: Runner,
  config: OpsConfig,
  local: string,
  remote: string
): Promise<CommandResult> {
  return runner.run({
    argv: [
      "gcloud",
      "compute",
      "scp",
      local,
      `${config.instance}:${remote}`,
      `--zone=${config.zone}`,
      `--project=${config.project}`,
      "--tunnel-through-iap",
      "--quiet",
    ],
  });
}

export function sqlDescribe(runner: Runner, config: OpsConfig): Promise<CommandResult> {
  return runner.run({
    argv: [
      "gcloud",
      "sql",
      "instances",
      "describe",
      config.databaseInstance,
      `--project=${config.project}`,
      "--format=value(state)",
    ],
  });
}

export function instanceDescribe(runner: Runner, config: OpsConfig): Promise<CommandResult> {
  return runner.run({
    argv: [
      "gcloud",
      "compute",
      "instances",
      "describe",
      config.instance,
      `--zone=${config.zone}`,
      `--project=${config.project}`,
      "--format=value(status)",
    ],
  });
}

export function addressDescribe(runner: Runner, config: OpsConfig): Promise<CommandResult> {
  return runner.run({
    argv: [
      "gcloud",
      "compute",
      "addresses",
      "describe",
      config.address,
      `--region=${config.region}`,
      `--project=${config.project}`,
      "--format=value(status)",
    ],
  });
}
