import { AdapterClientError, createAdapterClient } from "@/lib/adapter-client";

/**
 * The console's client for a registered adapter's STT path, contract v1.
 *
 * A turn's audio is sent as multipart with the language, model, timestamps flag
 * and opaque config the adapter's manifest declares. The answer is read whole
 * and refused whole: a transcription with no text is not a transcription, and a
 * confidence or a segment outside the contract is a malformed answer rather
 * than a value to clamp.
 */

export interface AdapterSttInput {
  endpoint: string;
  token: string;
  adapterId: string;
  tenantId: string;
  /** The recording. WAV 16 kHz mono is the contract's preferred form. */
  audio: Uint8Array;
  language?: string;
  model?: string;
  timestamps?: boolean;
  config?: Record<string, unknown> | null;
  /** What the adapter's manifest declares it accepts. Absent means no local check. */
  declared?: AdapterSttDeclaration;
  /** The recording's format when the caller knows it; detected otherwise. */
  format?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

/**
 * The part of an adapter's manifest that bounds an STT call.
 *
 * These are read before the request is made: audio the adapter declares it
 * cannot take, or that is larger or longer than it allows, is refused here as
 * `unsupported` rather than sent to be refused there. It is never retried — the
 * input is the problem, and the same bytes would be refused again.
 */
export interface AdapterSttDeclaration {
  /** `capabilities.stt.formats`; empty or absent means the adapter states none. */
  formats?: readonly string[];
  /** `limits.maxAudioSeconds`. */
  maxAudioSeconds?: number;
  /** `limits.maxRequestBytes`. */
  maxRequestBytes?: number;
}

export interface AdapterSttSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export type AdapterSttFailure =
  | "unsupported"
  | "timeout"
  | "network"
  | "rate_limit"
  | "upstream"
  | "http"
  | "malformed-response"
  | "response-too-large";

export type AdapterSttResult =
  | {
      ok: true;
      text: string;
      language?: string;
      confidence?: number;
      segments: AdapterSttSegment[];
    }
  | { ok: false; reason: AdapterSttFailure; detail: string };

/** The multipart body the adapter's `/v1/stt/transcribe` accepts. */
export function adapterSttForm(input: AdapterSttInput): FormData {
  const form = new FormData();
  form.append("audio", new Blob([input.audio as BlobPart], { type: "audio/wav" }), "audio.wav");
  if (input.language !== undefined && input.language !== "") {
    form.append("language", input.language);
  }
  if (input.model !== undefined && input.model !== "") {
    form.append("model", input.model);
  }
  if (input.timestamps !== undefined) {
    form.append("timestamps", input.timestamps ? "true" : "false");
  }
  if (input.config !== undefined && input.config !== null) {
    form.append("config", JSON.stringify(input.config));
  }
  return form;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the adapter's answer, or refuse it.
 *
 * `text`, `language` and `confidence` are the fields a turn needs; `segments`
 * are optional timestamps a caller may read. Every present field has to be the
 * shape the contract states — an absent optional is not an error, but a wrongly
 * typed one is.
 */
export function parseAdapterSttResponse(value: unknown): AdapterSttResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "malformed-response", detail: "the adapter answered with no object" };
  }
  if (typeof value.text !== "string") {
    return { ok: false, reason: "malformed-response", detail: "the answer carried no text" };
  }

  let language: string | undefined;
  if (value.language !== undefined) {
    if (typeof value.language !== "string") {
      return {
        ok: false,
        reason: "malformed-response",
        detail: "the answer's language is not a string",
      };
    }
    language = value.language;
  }

  let confidence: number | undefined;
  if (value.confidence !== undefined) {
    if (
      typeof value.confidence !== "number" ||
      !Number.isFinite(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1
    ) {
      return {
        ok: false,
        reason: "malformed-response",
        detail: "the answer's confidence is not between 0 and 1",
      };
    }
    confidence = value.confidence;
  }

  const segments: AdapterSttSegment[] = [];
  if (value.segments !== undefined) {
    if (!Array.isArray(value.segments)) {
      return {
        ok: false,
        reason: "malformed-response",
        detail: "the answer's segments are not a list",
      };
    }
    for (const raw of value.segments) {
      if (
        !isRecord(raw) ||
        typeof raw.startMs !== "number" ||
        typeof raw.endMs !== "number" ||
        typeof raw.text !== "string" ||
        !Number.isFinite(raw.startMs) ||
        !Number.isFinite(raw.endMs) ||
        raw.startMs < 0 ||
        raw.endMs < raw.startMs
      ) {
        return {
          ok: false,
          reason: "malformed-response",
          detail: "the answer carried a segment that is not a start, an end and its text",
        };
      }
      segments.push({ startMs: raw.startMs, endMs: raw.endMs, text: raw.text });
    }
  }

  return {
    ok: true,
    text: value.text,
    ...(language === undefined ? {} : { language }),
    ...(confidence === undefined ? {} : { confidence }),
    segments,
  };
}

/** The container a recording is in, when its bytes say so. */
function audioFormat(audio: Uint8Array): string | undefined {
  const ascii = (from: number, length: number): string =>
    String.fromCharCode(...audio.subarray(from, from + length));
  if (audio.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "wav";
  if (audio.length >= 4 && ascii(0, 4) === "OggS") return "opus";
  return undefined;
}

/** The duration and size a WAV header states, or undefined for anything else. */
function wavAudio(
  audio: Uint8Array
): { seconds: number; dataBytes: number } | undefined {
  if (audio.length < 44 || audioFormat(audio) !== "wav") return undefined;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  let byteRate = 0;
  let dataBytes: number | undefined;
  let offset = 12;
  while (offset + 8 <= audio.length) {
    const id = String.fromCharCode(...audio.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && size >= 16 && offset + 8 + 16 <= audio.length) {
      byteRate = view.getUint32(offset + 16, true);
    } else if (id === "data") {
      dataBytes = Math.min(size, audio.length - (offset + 8));
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (byteRate === 0 || dataBytes === undefined) return undefined;
  return { seconds: dataBytes / byteRate, dataBytes };
}

/**
 * Whether the adapter's declaration refuses this recording before it is sent.
 *
 * Returns the reason, or undefined when the call may go. Only what the
 * declaration states is enforced: an adapter that states no formats or limits
 * is not given a local policy of this console's invention.
 */
function declaredRefusal(
  input: AdapterSttInput
): string | undefined {
  const declared = input.declared;
  if (declared === undefined) return undefined;

  const format = input.format ?? audioFormat(input.audio);
  if (
    format !== undefined &&
    declared.formats !== undefined &&
    declared.formats.length > 0 &&
    !declared.formats.includes(format)
  ) {
    return `the adapter does not accept ${format} audio`;
  }

  if (
    declared.maxRequestBytes !== undefined &&
    input.audio.byteLength > declared.maxRequestBytes
  ) {
    return "the recording is larger than the adapter allows";
  }

  if (declared.maxAudioSeconds !== undefined) {
    const wav = wavAudio(input.audio);
    if (wav !== undefined && wav.seconds > declared.maxAudioSeconds) {
      return "the recording is longer than the adapter allows";
    }
  }
  return undefined;
}

/** Transcribe one recording through a registered adapter. */
export async function transcribeWithAdapter(
  input: AdapterSttInput
): Promise<AdapterSttResult> {
  // Audio the adapter declares it cannot take is refused before any bytes are
  // sent, and is not retried: the input is the problem, not the transport.
  const refusal = declaredRefusal(input);
  if (refusal !== undefined) {
    return { ok: false, reason: "unsupported", detail: refusal };
  }

  const client = createAdapterClient({
    endpoint: input.endpoint,
    token: input.token,
    adapterId: input.adapterId,
    tenantId: input.tenantId,
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: input.maxResponseBytes }),
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
  });

  try {
    const response = await client.request<unknown>("/stt/transcribe", {
      method: "POST",
      body: adapterSttForm(input),
    });
    return parseAdapterSttResponse(response.body);
  } catch (error) {
    if (error instanceof AdapterClientError) {
      // Audio beyond the adapter's declared limits. It is a refusal about the
      // input, not a failure to retry: sending it again would be refused again.
      if (error.status === 422) {
        return {
          ok: false,
          reason: "unsupported",
          detail: "the adapter refused the audio as unsupported",
        };
      }
      return { ok: false, reason: error.code, detail: error.message };
    }
    return {
      ok: false,
      reason: "network",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
