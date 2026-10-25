import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_DEFAULTS, loadConfig } from "../src/lib/config";

const DB = "postgresql://user:password@localhost:5432/gadget_console";
const TOKEN = "t".repeat(16);

/** 32 zero bytes, base64: a valid key shape for cases that do not encrypt. */
const LLM_KEY = Buffer.alloc(32).toString("base64");

/** Next augments ProcessEnv with a required NODE_ENV; a test supplies only what it reads. */
const env = (fields: Record<string, string>): NodeJS.ProcessEnv =>
  ({ LLM_KEY_SECRET: LLM_KEY, ...fields }) as unknown as NodeJS.ProcessEnv;

describe("the key that encrypts LLM keys", () => {
  it("refuses to load without one", () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL: DB, BRIDGE_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv),
      /LLM_KEY_SECRET must be set/
    );
  });

  it("refuses a value that is not 32 bytes", () => {
    const short = Buffer.alloc(16).toString("base64");
    assert.throws(
      () =>
        loadConfig({
          DATABASE_URL: DB,
          BRIDGE_TOKEN: TOKEN,
          LLM_KEY_SECRET: short,
        } as unknown as NodeJS.ProcessEnv),
      /exactly 32 bytes/
    );
  });
});

describe("the console's configuration", () => {
  it("refuses to start without a database", () => {
    assert.throws(() => loadConfig(env({ BRIDGE_TOKEN: TOKEN })), /DATABASE_URL is required/);
  });

  it("refuses to start without a bridge token", () => {
    assert.throws(() => loadConfig(env({ DATABASE_URL: DB })), /BRIDGE_TOKEN is required/);
  });

  it("refuses a bridge token too short to be one", () => {
    assert.throws(
      () => loadConfig(env({ DATABASE_URL: DB, BRIDGE_TOKEN: "short" })),
      /at least 16 characters/
    );
  });

  it("keeps the deployment figures when unset", () => {
    const config = loadConfig(env({ DATABASE_URL: DB, BRIDGE_TOKEN: TOKEN }));
    assert.equal(config.sessionTtlMs, CONFIG_DEFAULTS.sessionTtlMs);
    assert.equal(config.claimTtlMs, CONFIG_DEFAULTS.claimTtlMs);
    assert.equal(config.retentionDays, CONFIG_DEFAULTS.retentionDays);
    assert.equal(config.unclaimedDeviceTtlMs, CONFIG_DEFAULTS.unclaimedDeviceTtlMs);
    assert.equal(config.pruneIntervalMs, CONFIG_DEFAULTS.pruneIntervalMs);
    assert.equal(config.pruneBatch, CONFIG_DEFAULTS.pruneBatch);
  });

  it("reads a stated figure and refuses a nonsense one", () => {
    const config = loadConfig(
      env({ DATABASE_URL: DB, BRIDGE_TOKEN: TOKEN, CLAIM_TTL_MS: "120000" })
    );
    assert.equal(config.claimTtlMs, 120000);
    assert.throws(
      () => loadConfig(env({ DATABASE_URL: DB, BRIDGE_TOKEN: TOKEN, RETENTION_DAYS: "0" })),
      /RETENTION_DAYS must be a positive integer/
    );
  });

  it("lets the prune interval be zero, which means no timer", () => {
    const off = loadConfig(env({ DATABASE_URL: DB, BRIDGE_TOKEN: TOKEN, PRUNE_INTERVAL_MS: "0" }));
    assert.equal(off.pruneIntervalMs, 0);

    assert.throws(
      () =>
        loadConfig(
          env({ DATABASE_URL: DB, BRIDGE_TOKEN: TOKEN, PRUNE_INTERVAL_MS: "-1" })
        ),
      /PRUNE_INTERVAL_MS must be a whole number of milliseconds/
    );
    assert.throws(
      () => loadConfig(env({ DATABASE_URL: DB, BRIDGE_TOKEN: TOKEN, PRUNE_BATCH: "0" })),
      /PRUNE_BATCH must be a positive integer/
    );
  });
});
