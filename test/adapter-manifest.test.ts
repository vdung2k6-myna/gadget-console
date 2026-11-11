import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fetchAdapterManifest,
  validateAdapterManifest,
} from "../src/lib/adapter-manifest";

const MANIFEST = {
  contract: 1,
  id: "acme/gemini",
  version: "1.2.0",
  displayName: "Acme Gemini",
  kinds: ["llm"],
  capabilities: {
    llm: { streaming: true, tools: true, languages: ["vi", "en"] },
  },
  configSchema: { type: "object", required: ["model"] },
  privacy: { operator: "Acme", region: "vn", receives: ["text"], retention: "none" },
  usage: ["inputTokens", "outputTokens"],
  limits: { maxRequestBytes: 1_048_576 },
};

describe("the adapter manifest", () => {
  it("accepts a contract-1 manifest", () => {
    const result = validateAdapterManifest(MANIFEST);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.manifest.id, "acme/gemini");
    assert.deepEqual(result.manifest.kinds, ["llm"]);
    assert.equal(result.manifest.capabilities.llm?.tools, true);
  });

  it("refuses an unsupported contract and a malformed shape with a named reason", () => {
    assert.equal(
      (validateAdapterManifest({ ...MANIFEST, contract: 2 }) as { reason?: string }).reason,
      "unsupported-contract"
    );
    assert.equal(
      (validateAdapterManifest({ ...MANIFEST, kinds: ["video"] }) as { reason?: string }).reason,
      "invalid-kinds"
    );
    assert.equal(
      (
        validateAdapterManifest({ ...MANIFEST, capabilities: {} }) as { reason?: string }
      ).reason,
      "invalid-capabilities"
    );
    assert.equal(
      (
        validateAdapterManifest({
          ...MANIFEST,
          privacy: { receives: ["video"] },
        }) as { reason?: string }
      ).reason,
      "invalid-privacy"
    );
    assert.equal(
      (validateAdapterManifest({ ...MANIFEST, limits: { maxRequestBytes: -1 } }) as { reason?: string })
        .reason,
      "invalid-limits"
    );
    assert.equal(
      (validateAdapterManifest(null) as { reason?: string }).reason,
      "not-object"
    );
  });

  it("fetches /v1/manifest and passes an HTTP failure through", async () => {
    let url: string | undefined;
    const valid = await fetchAdapterManifest("https://adapter.example/v1", {
      token: "adp_test",
      fetchImpl: async (input) => {
        url = String(input);
        return new Response(JSON.stringify(MANIFEST), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    assert.equal(valid.ok, true);
    assert.equal(url, "https://adapter.example/v1/manifest");

    const failed = await fetchAdapterManifest("https://adapter.example/v1", {
      fetchImpl: async () => new Response("no", { status: 503 }),
    });
    assert.deepEqual(failed, { ok: false, reason: "http-error", status: 503 });
  });
});
