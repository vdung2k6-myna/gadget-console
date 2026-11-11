import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("the adapter conformance guide", () => {
  it("lists the suite cases and the published floor", async () => {
    const document = await readFile(new URL("../docs/ADAPTER_CONFORMANCE.md", import.meta.url), "utf8");
    for (const name of [
      "manifest-requires-auth",
      "manifest-refuses-tenant-mismatch",
      "llm-chat",
      "llm-tools",
      "llm-cancel",
      "error-mapping",
      "stt-transcribe",
      "tts-voices",
      "tts-audio",
      "0.15",
      "3.0",
      "runVietnameseBenchmark",
    ]) assert.ok(document.includes(name), name);
  });
});
