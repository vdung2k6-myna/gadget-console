import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AdapterClientError, createAdapterClient } from "../src/lib/adapter-client";

const base = {
  endpoint: "https://adapter.example/v1",
  token: "adp_secret-token",
  adapterId: "adapter-1",
  tenantId: "tenant-1",
  timeoutMs: 50,
  maxRetries: 2,
  sleep: async () => {},
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("the adapter client", () => {
  it("sends identity, contract and a request id without exposing the token", async () => {
    let headers: Headers | undefined;
    const client = createAdapterClient({
      ...base,
      fetchImpl: async (_url, init) => {
        headers = new Headers(init?.headers);
        return json({ ok: true });
      },
    });

    const response = await client.getJson<{ ok: boolean }>("/health");
    assert.deepEqual(response.body, { ok: true });
    assert.equal(headers?.get("x-adapter-id"), "adapter-1");
    assert.equal(headers?.get("x-tenant-id"), "tenant-1");
    assert.equal(headers?.get("x-contract-version"), "1");
    assert.equal(headers?.get("authorization"), "Bearer adp_secret-token");
    assert.ok((headers?.get("x-request-id") ?? "").length > 10);
  });

  it("bounds retries to idempotent calls", async () => {
    let calls = 0;
    const client = createAdapterClient({
      ...base,
      fetchImpl: async () => {
        calls += 1;
        return json({}, 429);
      },
    });

    await assert.rejects(
      () => client.getJson("/health"),
      (error: unknown) =>
        error instanceof AdapterClientError &&
        error.code === "rate_limit" &&
        !error.message.includes("adp_secret-token")
    );
    assert.equal(calls, 3, "an idempotent call retries twice");

    calls = 0;
    await assert.rejects(() => client.postJson("/chat", { prompt: "hi" }));
    assert.equal(calls, 1, "a non-idempotent call is not retried");
  });

  it("names timeout, malformed JSON and oversized bodies", async () => {
    const timeout = createAdapterClient({
      ...base,
      maxRetries: 0,
      fetchImpl: async () => {
        const error = new Error("timed out");
        error.name = "TimeoutError";
        throw error;
      },
    });
    await assert.rejects(
      () => timeout.getJson("/health"),
      (error: unknown) => error instanceof AdapterClientError && error.code === "timeout"
    );

    const malformed = createAdapterClient({
      ...base,
      fetchImpl: async () => new Response("not json", { status: 200 }),
    });
    await assert.rejects(
      () => malformed.getJson("/health"),
      (error: unknown) => error instanceof AdapterClientError && error.code === "malformed-response"
    );

    const large = createAdapterClient({
      ...base,
      maxResponseBytes: 4,
      fetchImpl: async () => json({ longer: "than four bytes" }),
    });
    await assert.rejects(
      () => large.getJson("/health"),
      (error: unknown) => error instanceof AdapterClientError && error.code === "response-too-large"
    );
  });
});
