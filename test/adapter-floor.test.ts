import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { VI_STT_WER_FLOOR, VI_TTS_NATURALNESS_FLOOR, speechAdapterAllowed } from "../src/lib/adapter-floor";

const adapter = (quality: Record<string, number> | null, status = "verified", health = "ok") =>
  ({ kinds: ["stt", "tts"], status, health, quality }) as never;

describe("the Vietnamese speech floor", () => {
  it("allows a verified adapter at or above the floors", () => {
    assert.deepEqual(
      speechAdapterAllowed(adapter({ wer: VI_STT_WER_FLOOR, ttsNaturalness: VI_TTS_NATURALNESS_FLOOR }), "vi"),
      { allowed: true }
    );
  });

  it("refuses below-floor, missing, unhealthy and unverified adapters", () => {
    assert.deepEqual(speechAdapterAllowed(adapter({ wer: 0.5, ttsNaturalness: 4 }), "vi"), {
      allowed: false,
      reason: "below-floor",
    });
    assert.deepEqual(speechAdapterAllowed(adapter({ ttsNaturalness: 4 }), "vi"), {
      allowed: false,
      reason: "missing-score",
    });
    assert.deepEqual(speechAdapterAllowed(adapter({ wer: 0.1, ttsNaturalness: 4 }, "verified", "down"), "vi"), {
      allowed: false,
      reason: "unhealthy",
    });
    assert.deepEqual(speechAdapterAllowed(adapter({ wer: 0.1, ttsNaturalness: 4 }, "pending"), "vi"), {
      allowed: false,
      reason: "not-verified",
    });
  });

  it("lets a below-floor adapter serve another language", () => {
    assert.deepEqual(speechAdapterAllowed(adapter({ wer: 0.9, ttsNaturalness: 1 }), "en"), {
      allowed: true,
    });
  });
});
