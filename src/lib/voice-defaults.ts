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
