import type { AdapterRow } from "@/lib/adapters";

/**
 * The Vietnamese hard floor for reseller speech.
 *
 * Platform speech remains the default and the reference. A reseller STT/TTS
 * adapter may serve Vietnamese only with a recorded score at or above these
 * floors; below them it may serve other languages. A missing score is not a pass.
 */
export const VI_STT_WER_FLOOR = 0.15;
export const VI_TTS_NATURALNESS_FLOOR = 3.0;

export type FloorRefusal = "not-verified" | "unhealthy" | "unsupported-kind" | "missing-score" | "below-floor";

export type FloorVerdict = { allowed: true } | { allowed: false; reason: FloorRefusal };

/** The scores a speech adapter records when it is benchmarked. */
export type SpeechQuality = { wer?: number; ttsNaturalness?: number } | null;

export type SpeechQualityVerdict =
  | { ok: true }
  | { ok: false; reason: "missing-score" | "below-floor" };

/**
 * The quality floor alone. Verification and health are the caller's checks.
 *
 * Both the adapter gate and the chain resolver read this, so a floor change
 * cannot reach one path without the other.
 */
export function speechQualityVerdict(
  kind: "stt" | "tts",
  quality: SpeechQuality
): SpeechQualityVerdict {
  if (kind === "stt") {
    const wer = quality?.wer;
    if (typeof wer !== "number") return { ok: false, reason: "missing-score" };
    if (wer > VI_STT_WER_FLOOR) return { ok: false, reason: "below-floor" };
    return { ok: true };
  }
  const naturalness = quality?.ttsNaturalness;
  if (typeof naturalness !== "number") return { ok: false, reason: "missing-score" };
  if (naturalness < VI_TTS_NATURALNESS_FLOOR) return { ok: false, reason: "below-floor" };
  return { ok: true };
}

export function speechAdapterAllowed(
  adapter: Pick<AdapterRow, "kinds" | "status" | "health" | "quality">,
  language: string
): FloorVerdict {
  if (adapter.status !== "verified") return { allowed: false, reason: "not-verified" };
  if (adapter.health !== "ok") return { allowed: false, reason: "unhealthy" };
  if (!adapter.kinds.includes("stt") && !adapter.kinds.includes("tts")) {
    return { allowed: false, reason: "unsupported-kind" };
  }
  if (language !== "vi" && language !== "vietnamese") return { allowed: true };

  if (adapter.kinds.includes("stt")) {
    const verdict = speechQualityVerdict("stt", adapter.quality);
    if (!verdict.ok) return { allowed: false, reason: verdict.reason };
  }
  if (adapter.kinds.includes("tts")) {
    const verdict = speechQualityVerdict("tts", adapter.quality);
    if (!verdict.ok) return { allowed: false, reason: verdict.reason };
  }
  return { allowed: true };
}
