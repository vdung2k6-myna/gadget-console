import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runConformance } from "../src/lib/adapter-conformance";

const INPUT = {
  endpoint: "https://adapter.example/v1",
  token: "adp_test",
  adapterId: "adapter-1",
  tenantId: "tenant-1",
  kinds: ["llm", "stt", "tts"] as const,
};

const MANIFEST = {
  contract: 1,
  id: "acme/adapter",
  version: "1.0.0",
  kinds: ["llm", "stt", "tts"],
  capabilities: {
    llm: { streaming: true, tools: true, languages: ["vi"] },
    stt: { languages: ["vi"] },
    tts: { voices: true, languages: ["vi"] },
  },
  privacy: { operator: "Acme", region: "vn", receives: ["text", "audio"] },
};

function passingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.signal?.aborted) {
    return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
  }
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (url.pathname.endsWith("/manifest")) {
    if (!headers.has("authorization")) return Promise.resolve(json({}, 401));
    if (
      headers.has("x-tenant-id") &&
      headers.get("x-tenant-id") !== "tenant-1"
    ) {
      return Promise.resolve(json({}, 403));
    }
    return Promise.resolve(json(MANIFEST));
  }
  if (url.pathname.endsWith("/health")) return Promise.resolve(json({ status: "ok" }));
  if (url.pathname.endsWith("/llm/chat")) {
    if (init?.body === "{}") return Promise.resolve(json({ error: { code: "bad_request" } }, 400));
    return Promise.resolve(new Response(
      'event: text\ndata: {"type":"text","text":"ok"}\n\nevent: done\ndata: {"type":"done"}\n',
      { headers: { "content-type": "text/event-stream" } }
    ));
  }
  if (url.pathname.endsWith("/stt/transcribe")) return Promise.resolve(json({ text: "xin chào", language: "vi" }));
  if (url.pathname.endsWith("/tts/voices")) return Promise.resolve(json({ voices: ["default"] }));
  if (url.pathname.endsWith("/tts/speech")) return Promise.resolve(new Response(Buffer.from("RIFF"), { headers: { "content-type": "audio/wav" } }));
  return Promise.resolve(new Response("not found", { status: 404 }));
}

describe("adapter conformance", () => {
  it("passes a stub adapter that answers the contract", async () => {
    const result = await runConformance(INPUT, { fetchImpl: passingFetch });
    assert.equal(result.ok, true, JSON.stringify(result.cases.filter((c) => !c.ok)));
    const names = result.cases.map((entry) => entry.name);
    for (const name of ["manifest", "health", "llm-chat", "llm-tools", "llm-cancel", "error-mapping", "stt-transcribe", "tts-voices", "tts-audio"]) {
      assert.ok(names.includes(name), name);
    }
  });

  it("fails a stub adapter and names the failing cases", async () => {
    const result = await runConformance(INPUT, {
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });
    assert.equal(result.ok, false);
    assert.ok(result.cases.some((entry) => !entry.ok));
  });
});
