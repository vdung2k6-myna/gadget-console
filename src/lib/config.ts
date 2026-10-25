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
}

export const CONFIG_DEFAULTS = {
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  claimTtlMs: 10 * 60 * 1000,
  claimApprovalTtlMs: 24 * 60 * 60 * 1000,
  retentionDays: 90,
  unclaimedDeviceTtlMs: 7 * 24 * 60 * 60 * 1000,
  pruneIntervalMs: 6 * 60 * 60 * 1000,
  pruneBatch: 1000,
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
  };
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
