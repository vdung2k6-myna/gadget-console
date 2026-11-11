import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const DOC = new URL("../docs/ADAPTERS.md", import.meta.url);
const ONBOARDING = new URL("../docs/ADAPTER_ONBOARDING.md", import.meta.url);

describe("the adapter token guide", () => {
  it("names every implemented route and the one-time rule", async () => {
    const document = await readFile(DOC, "utf8");
    for (const name of [
      "POST \"https://<console-host>/api/admin/adapters\"",
      "curl -sS \"https://<console-host>/api/admin/adapters\"",
      "/api/admin/adapters/<adapter-id>/rotate",
      "/api/admin/adapters/<adapter-id>/disable",
      "adp_",
      "shown once",
      "previousExpiresAt",
      "pending",
      "/v1/tts/synthesize",
      "one complete audio file per request",
      "Streaming TTS is a future extension",
      "X-Audio-Format",
    ]) {
      assert.ok(document.includes(name), `the guide names ${name}`);
    }
  });

  it("walks onboarding from registration to the first selected turn", async () => {
    const document = await readFile(ONBOARDING, "utf8");
    for (const term of [
      "POST \"https://<console-host>/api/admin/adapters\"",
      "/rotate",
      "/disable",
      "GET /v1/manifest",
      "runConformance",
      "runVietnameseBenchmark",
      "verified",
      "providerChain",
      "adp_",
    ]) {
      assert.ok(document.includes(term), `the onboarding guide names ${term}`);
    }
  });
});
