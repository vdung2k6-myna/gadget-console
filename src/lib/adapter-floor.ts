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
    const wer = adapter.quality?.wer;
    if (typeof wer !== "number") return { allowed: false, reason: "missing-score" };
    if (wer > VI_STT_WER_FLOOR) return { allowed: false, reason: "below-floor" };
  }
  if (adapter.kinds.includes("tts")) {
    const naturalness = adapter.quality?.ttsNaturalness;
    if (typeof naturalness !== "number") return { allowed: false, reason: "missing-score" };
    if (naturalness < VI_TTS_NATURALNESS_FLOOR) return { allowed: false, reason: "below-floor" };
  }
  return { allowed: true };
}
