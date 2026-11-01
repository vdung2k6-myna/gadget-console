import type { OpsConfig } from "./config";
import type { Runner } from "./runner";

export interface OpsContext {
  runner: Runner;
  config: OpsConfig;
  configPath: string;
  dryRun: boolean;
  log: (line: string) => void;
  poll: { timeoutMs: number; intervalMs: number };
}
