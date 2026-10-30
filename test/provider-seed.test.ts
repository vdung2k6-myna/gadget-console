import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { providerProfiles } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

const SEED = JSON.stringify([
  {
    kind: "tts",
    name: "house-voice",
    baseUrl: "http://localhost:8082",
    model: "tts-1",
    voice: "voice-name",
    default: true,
  },
  {
    kind: "tts",
    name: "second-voice",
    baseUrl: "http://localhost:8082",
    model: "tts-1",
    voice: "other-name",
  },
  {
    kind: "stt",
    name: "house-transcriber",
    baseUrl: "http://localhost:8080",
    model: "stt",
    default: true,
  },
]);

/**
 * Run the seed against the test database.
 *
 * `PROVIDER_SEED` is set explicitly — including to empty — so the developer's
 * `.env` never decides what this test asserts.
 */
function seed(overrides: Record<string, string> = {}): string {
  return execFileSync(
    process.execPath,
    [join("node_modules", "tsx", "dist", "cli.mjs"), join("scripts", "seed-provider-profiles.ts")],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL!, PROVIDER_SEED: "", ...overrides },
      encoding: "utf8",
    }
  );
}

async function rows() {
  return getDb().select().from(providerProfiles);
}

describe("the provider seed", () => {
  it("seeds nothing when the deployment configures no provider", async () => {
    const output = seed();

    assert.match(output, /seeded nothing/);
    assert.equal((await rows()).length, 0);
  });

  it("publishes exactly the list the deployment configures, marking its defaults", async () => {
    seed({ PROVIDER_SEED: SEED });

    const seeded = await rows();
    assert.deepEqual(
      seeded.map((row) => [row.kind, row.name, row.model, row.voice, row.isDefault]).sort(),
      [
        ["stt", "house-transcriber", "stt", null, true],
        ["tts", "house-voice", "tts-1", "voice-name", true],
        ["tts", "second-voice", "tts-1", "other-name", false],
      ].sort()
    );
  });

  it("refuses a malformed list rather than publishing part of it", async () => {
    const bad = JSON.stringify([{ kind: "tts", name: "x", baseUrl: "not-a-url", model: "m", voice: "v" }]);

    assert.throws(() => seed({ PROVIDER_SEED: bad }), /baseUrl must be an absolute/);
    assert.equal((await rows()).length, 0, "nothing is written for a refused list");
  });

  it("adds nothing on a second run and keeps a provider it no longer lists", async () => {
    await getDb()
      .insert(providerProfiles)
      .values({
        userId: null,
        builtin: true,
        kind: "tts",
        name: "retired-voice",
        baseUrl: "http://localhost:8082",
        model: "tts-1",
        voice: "old-name",
        encryptedKey: "",
      });

    seed({ PROVIDER_SEED: SEED });
    const afterFirst = await rows();
    seed({ PROVIDER_SEED: SEED });
    const afterSecond = await rows();

    assert.equal(afterSecond.length, afterFirst.length, "the second run adds nothing");
    assert.equal(
      afterSecond.filter((row) => row.name === "retired-voice").length,
      1,
      "a provider the list no longer names is not deleted"
    );
  });
});
