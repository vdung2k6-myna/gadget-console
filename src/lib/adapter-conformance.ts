import { fetchAdapterManifest } from "@/lib/adapter-manifest";
import type { AdapterKind } from "@/lib/adapters";

/**
 * The conformance checks a private adapter must pass before verification.
 *
 * Each case is named and independent: one failing case does not hide the others.
 * The protocol fixtures are minimal — the point is that the adapter answers the
 * contract's surfaces with the right status, content type and shape, not that it
 * produces a particular sentence.
 */

export interface ConformanceCase {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface ConformanceResult {
  ok: boolean;
  cases: ConformanceCase[];
}

export interface ConformanceInput {
  endpoint: string;
  token: string;
  adapterId: string;
  tenantId: string;
  kinds: readonly AdapterKind[];
}

function headers(input: ConformanceInput, tenantId = input.tenantId, token = input.token) {
  return {
    authorization: `Bearer ${token}`,
    "x-adapter-id": input.adapterId,
    "x-tenant-id": tenantId,
    "x-contract-version": "1",
  };
}

export async function runConformance(
  input: ConformanceInput,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<ConformanceResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const url = (path: string) => `${input.endpoint.replace(/\/+$/, "")}${path}`;
  const cases: ConformanceCase[] = [];
  const add = (name: string, ok: boolean, detail?: string) => cases.push({ name, ok, detail });

  const unauthenticated = await doFetch(url("/manifest"), { headers: { "x-contract-version": "1" } });
  add("manifest-requires-auth", unauthenticated.status === 401, `status ${unauthenticated.status}`);
  await unauthenticated.body?.cancel().catch(() => {});

  const mismatched = await doFetch(url("/manifest"), {
    headers: headers(input, "another-tenant"),
  });
  add("manifest-refuses-tenant-mismatch", mismatched.status === 403, `status ${mismatched.status}`);
  await mismatched.body?.cancel().catch(() => {});

  const manifest = await fetchAdapterManifest(input.endpoint, {
    token: input.token,
    fetchImpl: doFetch,
  });
  add("manifest", manifest.ok, manifest.ok ? undefined : manifest.reason);

  const health = await doFetch(url("/health"), { headers: headers(input) });
  let healthOk = health.status === 200;
  if (healthOk) {
    const body = (await health.json().catch(() => ({}))) as { status?: unknown };
    healthOk = body.status === "ok";
  }
  add("health", healthOk, `status ${health.status}`);

  for (const kind of input.kinds) {
    if (kind === "llm") {
      const chat = await doFetch(url("/llm/chat"), {
        method: "POST",
        headers: { ...headers(input), "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "conformance" }] }),
      });
      const type = chat.headers.get("content-type") ?? "";
      const text = await chat.text().catch(() => "");
      add("llm-chat", chat.status === 200 && /event-stream/.test(type) && text.includes("done"),
        `status ${chat.status}, type ${type}`);

      const tools = await doFetch(url("/llm/chat"), {
        method: "POST",
        headers: { ...headers(input), "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "conformance" }],
          tools: [{ name: "echo", inputSchema: { type: "object" } }],
        }),
      });
      add("llm-tools", tools.status === 200, `status ${tools.status}`);
      await tools.body?.cancel().catch(() => {});

      const controller = new AbortController();
      controller.abort();
      let cancelled = false;
      try {
        await doFetch(url("/llm/chat"), {
          method: "POST",
          headers: { ...headers(input), "content-type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: "cancel" }] }),
          signal: controller.signal,
        });
      } catch (error) {
        cancelled = error instanceof Error && error.name === "AbortError";
      }
      add("llm-cancel", cancelled);

      const bad = await doFetch(url("/llm/chat"), {
        method: "POST",
        headers: { ...headers(input), "content-type": "application/json" },
        body: "{}",
      });
      const badBody = (await bad.json().catch(() => ({}))) as { error?: { code?: unknown } };
      add("error-mapping", bad.status === 400 && typeof badBody.error?.code === "string",
        `status ${bad.status}`);
    }

    if (kind === "stt") {
      const form = new FormData();
      form.append("language", "vi");
      form.append("audio", new Blob([Buffer.from("RIFF....WAVEfmt ")], { type: "audio/wav" }), "sample.wav");
      const stt = await doFetch(url("/stt/transcribe"), {
        method: "POST",
        headers: headers(input),
        body: form,
      });
      const body = (await stt.json().catch(() => ({}))) as { text?: unknown; language?: unknown };
      add("stt-transcribe", stt.status === 200 && typeof body.text === "string", `status ${stt.status}`);
    }

    if (kind === "tts") {
      const voices = await doFetch(url("/tts/voices"), { headers: headers(input) });
      const voiceBody = (await voices.json().catch(() => ({}))) as { voices?: unknown };
      add("tts-voices", voices.status === 200 && Array.isArray(voiceBody.voices), `status ${voices.status}`);

      const speech = await doFetch(url("/tts/synthesize"), {
        method: "POST",
        headers: { ...headers(input), "content-type": "application/json" },
        body: JSON.stringify({ text: "conformance", voice: "default", format: "wav" }),
      });
      const bytes = (await speech.arrayBuffer().catch(() => new ArrayBuffer(0))).byteLength;
      add("tts-audio", speech.status === 200 && bytes > 0, `status ${speech.status}, ${bytes} bytes`);
    }
  }

  return { ok: cases.every((entry) => entry.ok), cases };
}
