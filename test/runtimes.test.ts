import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeDb, requireTestDatabase, resetDb } from "./helpers/db";
import { createRuntime, ensureRuntime, publicRuntime } from "../src/lib/runtimes";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

const input = {
  name: "interview",
  baseUrl: "http://127.0.0.1:4000",
  token: "runtime-token-that-must-not-leak",
  engines: ["engine-a"],
  languages: ["vietnamese"],
};

describe("runtimes", () => {
  it("seeds once, however often it runs", async () => {
    const first = await ensureRuntime(input);
    const second = await ensureRuntime(input);
    assert.equal(first.id, second.id);
  });

  it("keeps the credential out of the browser-facing shape", async () => {
    const runtime = await createRuntime(input);
    const visible = publicRuntime(runtime) as Record<string, unknown>;
    assert.equal("token" in visible, false);
    assert.equal(JSON.stringify(visible).includes("runtime-token-that-must-not-leak"), false);
    assert.equal(visible.name, "interview");
  });
});
