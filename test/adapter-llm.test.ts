import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AdapterLlmStreamError,
  adapterLlmRequest,
  adapterToolCalls,
  parseAdapterLlmSse,
  streamAdapterLlm,
} from "../src/lib/adapter-llm";

const stream = (...events: unknown[]) =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

describe("the normalized LLM stream", () => {
  it("builds the streaming request with tools and config", () => {
    assert.deepEqual(
      adapterLlmRequest({
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "echo", inputSchema: { type: "object" } }],
        config: { model: "m" },
      }),
      {
        stream: true,
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "echo", inputSchema: { type: "object" } }],
        config: { model: "m" },
      }
    );
  });

  it("keeps text and tool order, usage before exactly one done", () => {
    const result = parseAdapterLlmSse(
      stream(
        { type: "text", text: "hello" },
        { type: "tool_call", id: "t1", name: "echo", arguments: { x: 1 }, metadata: { sig: "abc" } },
        { type: "text", text: " world" },
        { type: "usage", usage: { inputTokens: 3 } },
        { type: "done" }
      )
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.events.map((event) => event.type),
      ["text", "tool_call", "text", "usage", "done"]
    );
    assert.deepEqual(result.usage, { inputTokens: 3 });
    assert.deepEqual((result.events[1] as { metadata?: unknown }).metadata, { sig: "abc" });
  });

  it("replays tool-call metadata unchanged on the next request", () => {
    const parsed = parseAdapterLlmSse(
      stream(
        { type: "tool_call", id: "t1", name: "echo", arguments: { x: 1 }, metadata: { sig: "abc" } },
        { type: "usage", usage: {} },
        { type: "done" }
      )
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const calls = adapterToolCalls(parsed.events);
    const request = adapterLlmRequest({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "", toolCalls: calls },
      ],
    });
    assert.deepEqual((request.messages as Array<{ toolCalls?: unknown }>)[1]?.toolCalls, [
      { id: "t1", name: "echo", arguments: { x: 1 }, metadata: { sig: "abc" } },
    ]);
  });

  it("refuses a missing usage, a second done and an event after done", () => {
    assert.equal(
      (parseAdapterLlmSse(stream({ type: "text", text: "one" }, { type: "done" })) as { reason?: string })
        .reason,
      "missing-usage"
    );
    assert.equal(
      (
        parseAdapterLlmSse(
          stream({ type: "usage", usage: {} }, { type: "done" }, { type: "done" })
        ) as { reason?: string }
      ).reason,
      "event-after-done"
    );
    assert.equal(
      (
        parseAdapterLlmSse(
          stream({ type: "usage", usage: {} }, { type: "done" }, { type: "text", text: "late" })
        ) as { reason?: string }
      ).reason,
      "event-after-done"
    );
  });

  it("refuses malformed JSON and an unknown event", () => {
    assert.equal(
      (parseAdapterLlmSse("data: nope\n\n") as { reason?: string }).reason,
      "malformed-event"
    );
    assert.equal(
      (parseAdapterLlmSse(stream({ type: "video" })) as { reason?: string }).reason,
      "unknown-event"
    );
  });
});


function llmStream(chunks: string[], keepOpen = false) {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      if (!keepOpen) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

const inputs = {
  endpoint: "https://adapter.example/v1",
  token: "adp_test",
  adapterId: "a",
  tenantId: "t",
  request: { stream: true, messages: [] },
};

describe("the cancellable LLM stream", () => {
  it("stops at done and never consumes a late event", async () => {
    const source = llmStream([
      'data: {"type":"text","text":"hi"}\n\n',
      'data: {"type":"usage","usage":{}}\n\n',
      'data: {"type":"done"}\n\n',
      'data: {"type":"text","text":"late"}\n\n',
    ]);
    const result = await streamAdapterLlm({
      ...inputs,
      fetchImpl: async () => new Response(source.stream, { status: 200 }),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.events.map((event) => event.type), ["text", "usage", "done"]);
    assert.equal(source.cancelled(), true);
  });

  it("aborts the reader when the caller cancels", async () => {
    const controller = new AbortController();
    const source = llmStream(['data: {"type":"text","text":"hi"}\n\n'], true);
    const pending = streamAdapterLlm({
      ...inputs,
      signal: controller.signal,
      fetchImpl: async () => new Response(source.stream, { status: 200 }),
    });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof AdapterLlmStreamError && error.code === "aborted"
    );
  });

  it("fails an idle stream", async () => {
    const source = llmStream([], true);
    await assert.rejects(
      streamAdapterLlm({
        ...inputs,
        idleTimeoutMs: 20,
        fetchImpl: async () => new Response(source.stream, { status: 200 }),
      }),
      (error: unknown) => error instanceof AdapterLlmStreamError && error.code === "idle-timeout"
    );
  });
});
