/**
 * The normalized LLM stream.
 *
 * Contract v1 sends server-sent events whose data is JSON. The platform turns
 * them into four event shapes and refuses a stream with a second `done`, an
 * event after `done`, usage after `done`, or a missing usage. Tool-call metadata
 * is kept opaque so the next request can replay it unchanged.
 */

export interface AdapterLlmToolCall {
  id: string;
  name: string;
  arguments: unknown;
  /** Opaque provider metadata, replayed exactly as received. */
  metadata?: unknown;
}

export interface AdapterLlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: readonly AdapterLlmToolCall[];
}

export interface AdapterLlmTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** The request body the adapter's `/v1/llm/chat` accepts. */
export function adapterLlmRequest(input: {
  messages: readonly AdapterLlmMessage[];
  tools?: readonly AdapterLlmTool[];
  config?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return {
    stream: true,
    messages: input.messages.map(({ role, content, toolCalls }) => ({
      role,
      content,
      ...(toolCalls === undefined || toolCalls.length === 0 ? {} : { toolCalls }),
    })),
    ...(input.tools === undefined || input.tools.length === 0
      ? {}
      : {
          tools: input.tools.map(({ name, description, inputSchema }) => ({
            name,
            ...(description === undefined ? {} : { description }),
            ...(inputSchema === undefined ? {} : { inputSchema }),
          })),
        }),
    ...(input.config === null || input.config === undefined ? {} : { config: input.config }),
  };
}

/** Tool calls from a parsed stream, ready to replay on the next request. */
export function adapterToolCalls(
  events: readonly AdapterLlmEvent[]
): AdapterLlmToolCall[] {
  return events
    .filter((event): event is Extract<AdapterLlmEvent, { type: "tool_call" }> =>
      event.type === "tool_call"
    )
    .map(({ id, name, arguments: args, metadata }) => ({
      id,
      name,
      arguments: args,
      ...(metadata === undefined ? {} : { metadata }),
    }));
}

export type AdapterLlmEvent =
  | { type: "text"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      arguments: unknown;
      metadata?: unknown;
    }
  | { type: "usage"; usage: Record<string, unknown> }
  | { type: "done" };

export type AdapterLlmRefusal =
  | "malformed-event"
  | "unknown-event"
  | "missing-usage"
  | "usage-after-done"
  | "event-after-done"
  | "duplicate-done";

export type AdapterLlmParse =
  | { ok: true; events: AdapterLlmEvent[]; usage: Record<string, unknown> }
  | { ok: false; reason: AdapterLlmRefusal };

function eventType(name: string | undefined, payload: Record<string, unknown>): string | undefined {
  if (typeof payload.type === "string") return payload.type;
  return name;
}

export function parseAdapterLlmSse(body: string): AdapterLlmParse {
  const events: AdapterLlmEvent[] = [];
  let usage: Record<string, unknown> | undefined;
  let done = false;

  let name: string | undefined;
  let data: string[] = [];

  const flush = (): AdapterLlmRefusal | undefined => {
    if (data.length === 0 && name === undefined) return undefined;
    const raw = data.join("\n").trim();
    name = name ?? undefined;
    data = [];
    if (raw === "") return "malformed-event";

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "malformed-event";
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      return "malformed-event";
    }

    const type = eventType(name, payload);
    name = undefined;
    if (done) return "event-after-done";

    if (type === "text") {
      if (usage !== undefined) return "malformed-event";
      if (typeof payload.text !== "string") return "malformed-event";
      events.push({ type: "text", text: payload.text });
      return undefined;
    }
    if (type === "tool_call") {
      if (usage !== undefined) return "malformed-event";
      if (
        typeof payload.id !== "string" ||
        typeof payload.name !== "string" ||
        payload.arguments === undefined
      ) {
        return "malformed-event";
      }
      events.push({
        type: "tool_call",
        id: payload.id,
        name: payload.name,
        arguments: payload.arguments,
        ...(payload.metadata === undefined ? {} : { metadata: payload.metadata }),
      });
      return undefined;
    }
    if (type === "usage") {
      if (usage !== undefined) return "malformed-event";
      if (typeof payload.usage !== "object" || payload.usage === null || Array.isArray(payload.usage)) {
        return "malformed-event";
      }
      usage = payload.usage as Record<string, unknown>;
      events.push({ type: "usage", usage });
      return undefined;
    }
    if (type === "done") {
      if (usage === undefined) return "missing-usage";
      done = true;
      events.push({ type: "done" });
      return undefined;
    }
    return type === undefined ? "malformed-event" : "unknown-event";
  };

  for (const line of body.split(/\r?\n/)) {
    if (line === "") {
      const refusal = flush();
      if (refusal !== undefined) return { ok: false, reason: refusal };
    } else if (line.startsWith("event:")) {
      name = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
    // Comments and other SSE fields are ignored.
  }
  const tail = flush();
  if (tail !== undefined) return { ok: false, reason: tail };
  if (!done) return { ok: false, reason: "missing-usage" };
  return { ok: true, events, usage: usage! };
}
