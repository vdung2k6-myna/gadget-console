import type { AgentVoiceConversion } from "./agent-voice-conversion";

/**
 * The deployment's voice defaults.
 *
 * An owner picks a language and hears a voice; the engine is the deployment's
 * `piper` and the voice follows the language. The voice stays editable, so a
 * provider that holds another voice can be used without a template in the way.
 */

export type DefaultLanguage = "english" | "vietnamese";

export const DEFAULT_TTS_ENGINE = "piper";

export const DEFAULT_VOICE_BY_LANGUAGE: Record<DefaultLanguage, string> = {
  english: "bryce",
  vietnamese: "vi_VN-vais1000-medium",
};

export const DEFAULT_NAME_BY_LANGUAGE: Record<DefaultLanguage, string> = {
  english: "My assistant",
  vietnamese: "Trợ lý của tôi",
};

export const DEFAULT_PROMPT_BY_LANGUAGE: Record<DefaultLanguage, string> = {
  english: "You are a friendly voice assistant. Keep answers short and conversational.",
  vietnamese: "Bạn là một trợ lý giọng nói thân thiện. Trả lời ngắn gọn và tự nhiên.",
};

function asLanguage(language: string): DefaultLanguage {
  return language === "vietnamese" ? "vietnamese" : "english";
}

export function defaultVoiceFor(language: string): string {
  return DEFAULT_VOICE_BY_LANGUAGE[asLanguage(language)];
}

export function defaultNameFor(language: string): string {
  return DEFAULT_NAME_BY_LANGUAGE[asLanguage(language)];
}

export function defaultPromptFor(language: string): string {
  return DEFAULT_PROMPT_BY_LANGUAGE[asLanguage(language)];
}

/** The sample a preview speaks: the language it is in, not the console's. */
export function rehearsalTextFor(language: string): string {
  return asLanguage(language) === "vietnamese"
    ? "Xin chào, đây là giọng nói của tôi."
    : "Hello, this is how I sound.";
}

export type VoiceStyle = "inherit" | "off" | "natural" | "deep" | "monster" | "custom";

/** The OVC shapes the simple form offers; Custom keeps the stored config. */
export const VOICE_STYLE_PRESETS: Record<
  Exclude<VoiceStyle, "custom">,
  AgentVoiceConversion | null
> = {
  inherit: null,
  off: { enabled: false },
  natural: { pitchShift: 0, formantShift: 0, f0Method: "pm", effects: {} },
  deep: {
    pitchShift: -6,
    formantShift: -4,
    f0Method: "pm",
    effects: { eq: { enabled: true, low: 4, high: -2 } },
  },
  monster: {
    pitchShift: -9,
    formantShift: -5,
    f0Method: "pm",
    effects: {
      distortion: { enabled: true, drive: 0.45 },
      reverb: { enabled: true, size: 0.35, mix: 0.25 },
    },
  },
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

export function sameVoiceConfig(
  a: AgentVoiceConversion | null,
  b: AgentVoiceConversion | null
): boolean {
  return canonical(a) === canonical(b);
}

export function voiceStyleFor(config: AgentVoiceConversion | null): VoiceStyle {
  if (config === null) return "inherit";
  for (const id of ["off", "natural", "deep", "monster"] as const) {
    if (sameVoiceConfig(config, VOICE_STYLE_PRESETS[id])) return id;
  }
  return "custom";
}
