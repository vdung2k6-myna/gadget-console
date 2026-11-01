import type { OpsConfig } from "./config";

/**
 * The speech services run on another machine behind a tunnel. This tool checks
 * that they answer and says so; it never starts or reconfigures them.
 */
export interface SpeechProbe {
  kind: "stt" | "tts";
  url: string;
  ok: boolean;
  detail: string;
}

export async function probeSpeech(
  config: OpsConfig,
  options: { timeoutMs?: number; dryRun?: boolean; log?: (line: string) => void } = {}
): Promise<SpeechProbe[]> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const results: SpeechProbe[] = [];
  for (const [kind, url] of [
    ["stt", config.speech.sttUrl],
    ["tts", config.speech.ttsUrl],
  ] as const) {
    if (options.dryRun === true) {
      options.log?.(`would probe ${kind} at ${url}`);
      results.push({ kind, url, ok: true, detail: "not probed" });
      continue;
    }
    try {
      const answer = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      results.push({ kind, url, ok: answer.ok, detail: `HTTP ${answer.status}` });
    } catch (error) {
      results.push({
        kind,
        url,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
