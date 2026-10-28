/**
 * The console's configuration.
 *
 * Two values have no default on purpose: the database it owns and the token the
 * bridge presents. A console that guessed either would start and then answer
 * nothing useful — or, worse, accept a request it could not authenticate — so
 * both are refused at start instead.
 *
 * Everything else is a stated default, because the specs call these figures the
 * deployment's: how long a session lives, how long a claim code is good for, and
 * how long a turn is kept.
 */

export interface ConsoleConfig {
  databaseUrl: string;
  bridgeToken: string;
  /**
   * The 32-byte key, base64, that encrypts an account's LLM key at rest. Required
   * even for a deployment that has saved no profile: a profile stored under no
   * key would be one nobody can ever decrypt, and that is worse than refusing to
   * start.
   */
  llmKeySecret: string;
  sessionTtlMs: number;
  claimTtlMs: number;
  /** How long a request waits for an admin's approval before it is abandoned. */
  claimApprovalTtlMs: number;
  retentionDays: number;
  /**
   * Accounts that can never be demoted, however they are reached. Named by the
   * deployment rather than by this file, because the repository is published and
   * the account it guards is nobody else's business. Empty means none.
   */
  protectedAdmins: string[];
  /**
   * How old a device row nobody owns must be before the prune may remove it.
   * Generous on purpose: removing the row costs the gadget nothing but a new
   * code at its next boot, while removing it too early is the only way this
   * figure can hurt a person.
   */
  unclaimedDeviceTtlMs: number;
  /** How often the prune runs. `0` turns the timer off for a deployment that runs it elsewhere. */
  pruneIntervalMs: number;
  /** Rows one prune removes per kind, so a backlog is worked off in steps rather than one lock. */
  pruneBatch: number;
  /**
   * Where firmware images live. Null means the deployment has not configured a
   * place to keep one; an upload is then refused rather than written somewhere
   * nobody backs up.
   */
  firmwareDir: string | null;
  /**
   * The address a *gadget* reaches this console at, used to build a firmware
   * download URL. Null means releases may be stored but none is delivered, so a
   * deployment that has not set it keeps behaving as it did.
   */
  consolePublicUrl: string | null;
  /** The largest image the console will store. A board image is a few megabytes. */
  firmwareMaxBytes: number;
}

export const CONFIG_DEFAULTS = {
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  claimTtlMs: 10 * 60 * 1000,
  claimApprovalTtlMs: 24 * 60 * 60 * 1000,
  retentionDays: 90,
  unclaimedDeviceTtlMs: 7 * 24 * 60 * 60 * 1000,
  pruneIntervalMs: 6 * 60 * 60 * 1000,
  pruneBatch: 1000,
  firmwareMaxBytes: 8 * 1024 * 1024,
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConsoleConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required: the console owns the only database");
  }

  const bridgeToken = env.BRIDGE_TOKEN?.trim();
  if (!bridgeToken) {
    throw new Error("BRIDGE_TOKEN is required: the bridge authenticates with it");
  }
  if (bridgeToken.length < 16) {
    throw new Error(
      `BRIDGE_TOKEN must be at least 16 characters, got ${bridgeToken.length}`
    );
  }

  return {
    databaseUrl,
    bridgeToken,
    llmKeySecret: readLlmKeySecret(env),
    sessionTtlMs: readInt(env, "SESSION_TTL_MS", CONFIG_DEFAULTS.sessionTtlMs),
    claimTtlMs: readInt(env, "CLAIM_TTL_MS", CONFIG_DEFAULTS.claimTtlMs),
    claimApprovalTtlMs: readInt(
      env,
      "CLAIM_APPROVAL_TTL_MS",
      CONFIG_DEFAULTS.claimApprovalTtlMs
    ),
    retentionDays: readInt(env, "RETENTION_DAYS", CONFIG_DEFAULTS.retentionDays),
    protectedAdmins: readAddresses(env, "PROTECTED_ADMINS"),
    unclaimedDeviceTtlMs: readInt(
      env,
      "UNCLAIMED_DEVICE_TTL_MS",
      CONFIG_DEFAULTS.unclaimedDeviceTtlMs
    ),
    pruneIntervalMs: readNonNegativeInt(
      env,
      "PRUNE_INTERVAL_MS",
      CONFIG_DEFAULTS.pruneIntervalMs
    ),
    pruneBatch: readInt(env, "PRUNE_BATCH", CONFIG_DEFAULTS.pruneBatch),
    firmwareDir: readOptionalPath(env, "FIRMWARE_DIR"),
    consolePublicUrl: readPublicUrl(env),
    firmwareMaxBytes: readInt(env, "FIRMWARE_MAX_BYTES", CONFIG_DEFAULTS.firmwareMaxBytes),
  };
}

/** A directory the deployment names, or null for one it did not. */
function readOptionalPath(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name]?.trim();
  return raw === undefined || raw === "" ? null : raw;
}

/**
 * The base a gadget uses to download an image. Absolute http or https, without a
 * query or fragment, and stored without a trailing slash so a path can be joined
 * with one. Unset is not an error — it is a deployment that stores no releases
 * for delivery.
 */
function readPublicUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env.CONSOLE_PUBLIC_URL?.trim();
  if (raw === undefined || raw === "") return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`CONSOLE_PUBLIC_URL must be an absolute URL, got ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`CONSOLE_PUBLIC_URL must be http or https, got ${JSON.stringify(raw)}`);
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error(
      `CONSOLE_PUBLIC_URL must be a base URL without a query or fragment, got ${JSON.stringify(raw)}`
    );
  }
  return raw.replace(/\/+$/, "");
}

/**
 * The key an account's LLM key is encrypted under. Exactly 32 bytes, base64:
 * anything else is refused here rather than at the first save, where the
 * symptom would be a profile that cannot be decrypted.
 */
function readLlmKeySecret(env: NodeJS.ProcessEnv): string {
  const raw = env.LLM_KEY_SECRET?.trim() ?? "";
  if (raw === "") {
    throw new Error(
      "LLM_KEY_SECRET must be set: it encrypts every account's LLM key. Generate one with " +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) {
    throw new Error(
      `LLM_KEY_SECRET must decode to exactly 32 bytes, got ${bytes.length}`
    );
  }
  return raw;
}

/**
 * A comma-separated list of addresses, lowercased and trimmed. An empty or absent
 * value is an empty list, not an error: a deployment that protects nobody is a
 * legitimate one.
 */
function readAddresses(env: NodeJS.ProcessEnv, name: string): string[] {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${name} must be a positive integer, got ${JSON.stringify(raw)}`
    );
  }
  return value;
}

/**
 * The same, but zero is meaningful rather than nonsense: an interval of zero is
 * how a deployment says it will run the prune itself.
 */
function readNonNegativeInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${name} must be a whole number of milliseconds, zero or more, got ${JSON.stringify(raw)}`
    );
  }
  return value;
}
