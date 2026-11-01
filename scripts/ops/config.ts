import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Runner } from "./runner";

/**
 * The operator's own view of the deployment: names, not secrets. It lives in
 * `ops.local.json`, which is gitignored so it is absent from `git archive`; the
 * committed `ops.example.json` carries placeholders instead.
 */
export interface OpsConfig {
  project: string;
  region: string;
  zone: string;
  instance: string;
  databaseInstance: string;
  address: string;
  deployUser: string;
  speech: { sttUrl: string; ttsUrl: string };
  /**
   * The host that runs the speech tier, when it is not the operator's machine.
   * `healthUrl` is reached from the app host, because the gateway is private.
   */
  audio?: { instance: string; zone?: string; healthUrl: string };
  repositories?: { console?: string; bridge?: string; runtime?: string };
  /** A turn younger than this refuses a stop. */
  guardMinutes?: number;
}

export const DEFAULT_CONFIG_FILE = "ops.local.json";
export const DEFAULT_GUARD_MINUTES = 15;
export const DEFAULT_KEEP_RELEASES = 3;

const REQUIRED = [
  "project",
  "region",
  "zone",
  "instance",
  "databaseInstance",
  "address",
  "deployUser",
] as const;

export function parseOpsConfig(raw: unknown): OpsConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("the operator configuration must be a JSON object");
  }
  const body = raw as Record<string, unknown>;
  const missing = REQUIRED.filter(
    (key) => typeof body[key] !== "string" || (body[key] as string).trim() === ""
  );
  if (missing.length > 0) {
    throw new Error(`the operator configuration is missing ${missing.join(", ")}`);
  }

  const speech = body.speech;
  if (typeof speech !== "object" || speech === null) {
    throw new Error("the operator configuration is missing speech.sttUrl and speech.ttsUrl");
  }
  const sttUrl = (speech as Record<string, unknown>).sttUrl;
  const ttsUrl = (speech as Record<string, unknown>).ttsUrl;
  for (const [name, value] of [
    ["speech.sttUrl", sttUrl],
    ["speech.ttsUrl", ttsUrl],
  ] as const) {
    if (typeof value !== "string") {
      throw new Error(`the operator configuration is missing ${name}`);
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${name} must be an http or https URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${name} must be an http or https URL`);
    }
  }

  const guardMinutes = body.guardMinutes;
  if (
    guardMinutes !== undefined &&
    (typeof guardMinutes !== "number" || !Number.isFinite(guardMinutes) || guardMinutes < 0)
  ) {
    throw new Error("guardMinutes must be a non-negative number");
  }

  const audioRaw = body.audio;
  let audio: OpsConfig["audio"];
  if (audioRaw !== undefined) {
    if (typeof audioRaw !== "object" || audioRaw === null || Array.isArray(audioRaw)) {
      throw new Error("audio must be an object");
    }
    const candidate = audioRaw as Record<string, unknown>;
    if (typeof candidate.instance !== "string" || candidate.instance.trim() === "") {
      throw new Error("audio.instance is required when audio is configured");
    }
    if (
      candidate.zone !== undefined &&
      (typeof candidate.zone !== "string" || candidate.zone.trim() === "")
    ) {
      throw new Error("audio.zone must be a non-empty string");
    }
    if (typeof candidate.healthUrl !== "string") {
      throw new Error("audio.healthUrl is required when audio is configured");
    }
    let parsed: URL;
    try {
      parsed = new URL(candidate.healthUrl);
    } catch {
      throw new Error("audio.healthUrl must be an http or https URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("audio.healthUrl must be an http or https URL");
    }
    audio = {
      instance: candidate.instance,
      ...(typeof candidate.zone === "string" ? { zone: candidate.zone } : {}),
      healthUrl: candidate.healthUrl,
    };
  }

  return {
    project: body.project as string,
    region: body.region as string,
    zone: body.zone as string,
    instance: body.instance as string,
    databaseInstance: body.databaseInstance as string,
    address: body.address as string,
    deployUser: body.deployUser as string,
    speech: { sttUrl: sttUrl as string, ttsUrl: ttsUrl as string },
    ...(audio === undefined ? {} : { audio }),
    ...(typeof body.repositories === "object" && body.repositories !== null
      ? { repositories: body.repositories as OpsConfig["repositories"] }
      : {}),
    ...(typeof guardMinutes === "number" ? { guardMinutes } : {}),
  };
}

export async function loadOpsConfig(file: string): Promise<OpsConfig> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new Error(
      `no operator configuration at ${file}; copy ops.example.json to ${DEFAULT_CONFIG_FILE} and fill it in`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseOpsConfig(parsed);
}

/**
 * The configuration must never be inside the package. A file outside the
 * repository cannot be archived; one inside must be ignored by git.
 */
export async function assertConfigCannotBePackaged(
  runner: Runner,
  configPath: string,
  repoDir: string
): Promise<void> {
  const relative = path.relative(path.resolve(repoDir), path.resolve(configPath));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return;

  const ignored = await runner.run({
    argv: ["git", "-C", repoDir, "check-ignore", "-v", "--", relative],
    local: true,
  });
  if (ignored.code !== 0) {
    throw new Error(
      `refusing to deploy: ${relative} is inside the repository and not ignored; add it to .gitignore so the package cannot carry private values`
    );
  }
}
