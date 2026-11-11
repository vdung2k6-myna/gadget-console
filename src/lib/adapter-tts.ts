import { randomUUID } from "node:crypto";

/**
 * The console's client for a registered adapter's TTS path, contract v1.
 *
 * v1 returns one complete audio file per request. The answer is read whole and
 * checked as audio before it is handed on: the bridge can play WAV, and an
 * adapter that answers in a format it did not declare is refused here rather
 * than discovered downstream as sound nobody can hear.
 */

export interface AdapterTtsInput {
  endpoint: string;
  token: string;
  adapterId: string;
  tenantId: string;
  text: string;
  voice?: string;
  language?: string;
  /** The requested container; `wav` when absent. */
  format?: string;
  sampleRate?: number;
  rate?: number;
  config?: Record<string, unknown> | null;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

export interface AdapterVoice {
  id: string;
  name?: string;
  languages?: string[];
  gender?: string;
  styles?: string[];
}

export type AdapterTtsFailure =
  | "unsupported"
  | "timeout"
  | "network"
  | "rate_limit"
  | "upstream"
  | "http"
  | "malformed-response"
  | "response-too-large"
  | "empty-audio";

export type AdapterTtsResult =
  | {
      ok: true;
      audio: Buffer;
      contentType: string;
      format: string;
      sampleRate?: number;
    }
  | { ok: false; reason: AdapterTtsFailure; detail: string };

export type AdapterVoicesResult =
  | { ok: true; voices: AdapterVoice[] }
  | { ok: false; reason: AdapterTtsFailure; detail: string };

/** The JSON body the adapter's `/v1/tts/synthesize` accepts. */
export function adapterTtsRequest(input: AdapterTtsInput): Record<string, unknown> {
  return {
    text: input.text,
    ...(input.voice === undefined || input.voice === "" ? {} : { voice: input.voice }),
    ...(input.language === undefined || input.language === ""
      ? {}
      : { language: input.language }),
    format: input.format ?? "wav",
    ...(input.sampleRate === undefined ? {} : { sampleRate: input.sampleRate }),
    ...(input.rate === undefined ? {} : { rate: input.rate }),
    ...(input.config === undefined || input.config === null
      ? {}
      : { config: input.config }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWav(audio: Buffer): boolean {
  return (
    audio.length >= 12 &&
    audio.toString("ascii", 0, 4) === "RIFF" &&
    audio.toString("ascii", 8, 12) === "WAVE"
  );
}

function baseHeaders(input: {
  token: string;
  adapterId: string;
  tenantId: string;
}): Record<string, string> {
  return {
    authorization: `Bearer ${input.token}`,
    "x-adapter-id": input.adapterId,
    "x-tenant-id": input.tenantId,
    "x-contract-version": "1",
    "x-request-id": randomUUID(),
  };
}

function failureFor(status: number): AdapterTtsFailure {
  if (status === 422) return "unsupported";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "upstream";
  return "http";
}

/** Synthesize one piece of text through a registered adapter. */
export async function synthesizeWithAdapter(
  input: AdapterTtsInput
): Promise<AdapterTtsResult> {
  if (input.text.trim() === "") {
    return { ok: false, reason: "unsupported", detail: "there is no text to speak" };
  }
  const format = input.format ?? "wav";
  const request = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 30_000);

  try {
    const response = await request(`${input.endpoint.replace(/\/+$/, "")}/tts/synthesize`, {
      method: "POST",
      redirect: "error",
      headers: {
        ...baseHeaders(input),
        accept: "audio/*",
        "content-type": "application/json",
      },
      body: JSON.stringify(adapterTtsRequest(input)),
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return {
        ok: false,
        reason: failureFor(response.status),
        detail: `the adapter answered ${response.status}`,
      };
    }

    const declared = Number(response.headers.get("content-length") ?? "");
    const limit = input.maxResponseBytes ?? 16 * 1024 * 1024;
    if (Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel().catch(() => {});
      return {
        ok: false,
        reason: "response-too-large",
        detail: "the adapter's audio is larger than this console accepts",
      };
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length > limit) {
      return {
        ok: false,
        reason: "response-too-large",
        detail: "the adapter's audio is larger than this console accepts",
      };
    }
    if (audio.length === 0) {
      return { ok: false, reason: "empty-audio", detail: "the adapter answered no audio" };
    }
    if (format === "wav" && !isWav(audio)) {
      return {
        ok: false,
        reason: "malformed-response",
        detail: "the adapter answered with something that is not a WAV file",
      };
    }

    const sampleRate = Number(response.headers.get("x-sample-rate") ?? "");
    return {
      ok: true,
      audio,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      format: response.headers.get("x-audio-format") ?? format,
      ...(Number.isFinite(sampleRate) && sampleRate > 0 ? { sampleRate } : {}),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "timeout", detail: "the adapter did not answer in time" };
    }
    return {
      ok: false,
      reason: "network",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read the adapter's voice list.
 *
 * The list is optional metadata for a form: an adapter that names no voices is
 * not broken, but one that answers with something other than the contract's
 * list is refused rather than shown as an empty catalogue.
 */
export async function listAdapterVoices(input: {
  endpoint: string;
  token: string;
  adapterId: string;
  tenantId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<AdapterVoicesResult> {
  const request = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);

  try {
    const response = await request(`${input.endpoint.replace(/\/+$/, "")}/tts/voices`, {
      method: "GET",
      redirect: "error",
      headers: { ...baseHeaders(input), accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: failureFor(response.status),
        detail: `the adapter answered ${response.status}`,
      };
    }

    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      return { ok: false, reason: "malformed-response", detail: "the voice list is not JSON" };
    }
    if (!isRecord(body) || !Array.isArray(body.voices)) {
      return {
        ok: false,
        reason: "malformed-response",
        detail: "the adapter answered no voice list",
      };
    }

    const voices: AdapterVoice[] = [];
    for (const raw of body.voices) {
      if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") {
        return {
          ok: false,
          reason: "malformed-response",
          detail: "the adapter's voice list carried a voice without an id",
        };
      }
      voices.push({
        id: raw.id,
        ...(typeof raw.name === "string" ? { name: raw.name } : {}),
        ...(Array.isArray(raw.languages) &&
        raw.languages.every((language) => typeof language === "string")
          ? { languages: raw.languages as string[] }
          : {}),
        ...(typeof raw.gender === "string" ? { gender: raw.gender } : {}),
        ...(Array.isArray(raw.styles) &&
        raw.styles.every((style) => typeof style === "string")
          ? { styles: raw.styles as string[] }
          : {}),
      });
    }
    return { ok: true, voices };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "timeout", detail: "the adapter did not answer in time" };
    }
    return {
      ok: false,
      reason: "network",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}
