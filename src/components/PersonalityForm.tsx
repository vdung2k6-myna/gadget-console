"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/ui/client";
import {
  DEFAULT_TTS_ENGINE,
  defaultNameFor,
  defaultPromptFor,
  defaultVoiceFor,
  rehearsalTextFor,
} from "@/lib/voice-defaults";
import type { AgentValue, RuntimeOption } from "./AgentForm";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primary =
  "rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const secondary =
  "rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

export interface PersonalityDefaults {
  llm: string | null;
  stt: string | null;
  tts: string | null;
}

interface Props {
  runtimes: RuntimeOption[];
  defaults: PersonalityDefaults;
  agent?: AgentValue;
  isAdmin: boolean;
  onAdvanced?: () => void;
}

/**
 * The owner's form: a language, a voice and a preview.
 *
 * The deployment provides the engine and the default voice for each language
 * (`piper`; `bryce` in English, `vi_VN-vais1000-medium` in Vietnamese). The
 * owner may type another voice, hears it before saving, and never meets a
 * provider, a model or a key. The prompt and the rest of the definition are
 * behind Advanced.
 */
export function PersonalityForm({ runtimes, defaults, agent, isAdmin, onAdvanced }: Props) {
  const strings = useStrings();
  const router = useRouter();
  const editing = agent !== undefined;

  const [language, setLanguage] = useState(agent?.language ?? "english");
  const [voice, setVoice] = useState(agent?.voice ?? defaultVoiceFor(agent?.language ?? "english"));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewPending, setPreviewPending] = useState(false);

  const runtime = useMemo(
    () => runtimes.find((entry) => entry.id === agent?.runtimeId) ?? runtimes[0],
    [runtimes, agent?.runtimeId]
  );
  const languages = runtime?.languages ?? [];
  const voiceChoices = useMemo(
    () => [defaultVoiceFor("english"), defaultVoiceFor("vietnamese")],
    []
  );

  useEffect(() => {
    return () => {
      if (previewUrl !== "") URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function chooseLanguage(next: string): void {
    setLanguage(next);
    // The default follows the language; the owner can still type another voice.
    setVoice(defaultVoiceFor(next));
    setMessage(null);
  }

  async function preview(): Promise<void> {
    const previewVoice = voice.trim();
    if (previewVoice === "") {
      setPreviewError(strings.personality.previewFailed);
      return;
    }
    setPreviewPending(true);
    setPreviewError("");
    try {
      const response = await fetch("/api/agents/voice-conversion/audition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtimeId: runtime?.id ?? "",
          ttsProfileId: isAdmin ? (agent?.ttsProfileId ?? defaults.tts) : defaults.tts,
          voice: previewVoice,
          text: rehearsalTextFor(language),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setPreviewUrl(URL.createObjectURL(await response.blob()));
    } catch (error) {
      setPreviewError(
        error instanceof Error && error.message !== ""
          ? error.message
          : strings.personality.previewFailed
      );
    } finally {
      setPreviewPending(false);
    }
  }

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (runtime === undefined || languages.length === 0) {
      setMessage({ tone: "error", text: strings.personality.noRuntime });
      return;
    }
    if (defaults.llm === null) {
      setMessage({ tone: "error", text: strings.personality.noModel });
      return;
    }

    setPending(true);
    setMessage(null);
    const body = {
      // A personality created here has a neutral name and prompt for its
      // language; both stay editable under Advanced.
      name: agent?.name ?? defaultNameFor(language),
      systemPrompt: agent?.systemPrompt ?? defaultPromptFor(language),
      runtimeId: runtime.id,
      language,
      answerMode: agent?.answerMode ?? "generate",
      llmProfileId: isAdmin ? (agent?.llmProfileId ?? defaults.llm) : defaults.llm,
      sttProfileId: isAdmin ? (agent?.sttProfileId ?? defaults.stt) : defaults.stt,
      ttsProfileId: isAdmin ? (agent?.ttsProfileId ?? defaults.tts) : defaults.tts,
      voice: voice.trim() === "" ? null : voice.trim(),
      ovcConfig: agent?.ovcConfig ?? null,
      topics: agent?.topics ?? [],
    };

    const answer = editing
      ? await sendJson(`/api/agents/${agent.id}`, body, "PATCH")
      : await sendJson("/api/agents", body);
    setPending(false);

    if (!answer.ok) {
      setMessage({ tone: "error", text: `${strings.personality.refused} ${answer.message}`.trim() });
      return;
    }
    if (editing) {
      setMessage({ tone: "ok", text: strings.personality.saved });
      router.refresh();
      return;
    }
    router.push("/agents");
    router.refresh();
  }

  if (runtimes.length === 0 || languages.length === 0) {
    return <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{strings.personality.noRuntime}</p>;
  }

  return (
    <form onSubmit={save} className="mt-3 max-w-xl">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{strings.personality.voiceIntro}</p>

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
        {strings.personality.engine}: <span className="font-mono">{DEFAULT_TTS_ENGINE}</span>
      </p>

      <label className="mt-3 block text-sm">
        {strings.personality.language}
        <select
          className={field}
          value={languages.includes(language) ? language : (languages[0] ?? "")}
          onChange={(event) => chooseLanguage(event.target.value)}
        >
          {languages.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-sm">
        {strings.personality.voice}
        <input
          className={`${field} font-mono`}
          value={voice}
          onChange={(event) => {
            setVoice(event.target.value);
            setPreviewError("");
          }}
          list="personality-voices"
        />
        <datalist id="personality-voices">
          {voiceChoices.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {strings.personality.voiceHint}
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={secondary} disabled={previewPending} onClick={() => void preview()}>
          {previewPending ? strings.personality.previewing : strings.personality.preview}
        </button>
        <button type="submit" className={primary} disabled={pending}>
          {pending ? strings.personality.saving : strings.personality.save}
        </button>
        {onAdvanced !== undefined && (
          <button type="button" className="text-sm underline" onClick={onAdvanced}>
            {strings.personality.advanced}
          </button>
        )}
      </div>

      {previewUrl !== "" && (
        <audio className="mt-3 w-full" controls autoPlay src={previewUrl}>
          <track kind="captions" />
        </audio>
      )}
      {previewError !== "" && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">{previewError}</p>
      )}
      {message !== null && (
        <p
          className={`mt-3 text-sm ${
            message.tone === "ok"
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-red-700 dark:text-red-300"
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
