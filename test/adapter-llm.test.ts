import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { adapterLlmRequest, adapterToolCalls, parseAdapterLlmSse } from "../src/lib/adapter-llm";

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
