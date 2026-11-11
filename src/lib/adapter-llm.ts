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

export type AdapterLlmStreamFailure = "aborted" | "idle-timeout" | "network";

export class AdapterLlmStreamError extends Error {
  constructor(readonly code: AdapterLlmStreamFailure) {
    super(code === "idle-timeout" ? "the adapter stream went idle" : "the adapter stream was aborted");
    this.name = "AdapterLlmStreamError";
  }
}

/**
 * Read the LLM stream until `done`, the caller aborts, or the stream goes idle.
 * The reader is cancelled at `done`, so a late event after it is never consumed.
 */
export async function streamAdapterLlm(
  input: {
    endpoint: string;
    token: string;
    adapterId: string;
    tenantId: string;
    request: Record<string, unknown>;
    signal?: AbortSignal;
    idleTimeoutMs?: number;
    fetchImpl?: typeof fetch;
  }
): Promise<AdapterLlmParse> {
  const controller = new AbortController();
  let aborted = false;
  let idle = false;
  const onAbort = () => {
    aborted = true;
    controller.abort();
  };
  if (input.signal?.aborted) onAbort();
  else input.signal?.addEventListener("abort", onAbort, { once: true });

  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      idle = true;
      controller.abort();
    }, input.idleTimeoutMs ?? 30_000);
  };

  try {
    arm();
    const response = await (input.fetchImpl ?? fetch)(
      `${input.endpoint.replace(/\/+$/, "")}/llm/chat`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
          authorization: `Bearer ${input.token}`,
          "x-adapter-id": input.adapterId,
          "x-tenant-id": input.tenantId,
          "x-contract-version": "1",
        },
        body: JSON.stringify(input.request),
        signal: controller.signal,
      }
    );
    if (!response.ok || response.body === null) throw new AdapterLlmStreamError("network");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const abortedRead = new Promise<never>((_resolve, reject) => {
      const rejectAbort = () => reject(new Error("aborted"));
      if (controller.signal.aborted) rejectAbort();
      else controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), abortedRead]);
      if (done) break;
      arm();
      buffer += decoder.decode(value, { stream: true });
      if (/(^|\n)event:\s*done\b|"type"\s*:\s*"done"/.test(buffer)) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    return parseAdapterLlmSse(buffer);
  } catch (error) {
    if (error instanceof AdapterLlmStreamError) throw error;
    if (idle) throw new AdapterLlmStreamError("idle-timeout");
    if (aborted) throw new AdapterLlmStreamError("aborted");
    throw new AdapterLlmStreamError("network");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
  }
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
