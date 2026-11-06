"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/ui/client";
import {
  PERSONALITY_TEMPLATES,
  findPersonalityTemplate,
} from "@/lib/personality-templates";
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
 * The owner's form: pick a starting point, name it, choose a language and a
 * voice, listen, save. No provider, no runtime, no slider.
 *
 * The template is copied into an agent — its prompt, language and voice — and
 * the agent is saved on the deployment's built-in providers. The advanced form
 * stays one click away for an administrator, and for the rare owner who wants
 * the prompt or the conversion settings.
 */
export function PersonalityForm({ runtimes, defaults, agent, isAdmin, onAdvanced }: Props) {
  const strings = useStrings();
  const router = useRouter();
  const editing = agent !== undefined;

  const firstTemplate = PERSONALITY_TEMPLATES[0];
  const [templateId, setTemplateId] = useState<string>(
    editing ? "custom" : (firstTemplate?.id ?? "custom")
  );
  const template = templateId === "custom" ? undefined : findPersonalityTemplate(templateId);

  const initialRuntime =
    runtimes.find((runtime) => runtime.name === template?.runtimeName) ?? runtimes[0];
  const [name, setName] = useState(agent?.name ?? firstTemplate?.name ?? "");
  const [personality, setPersonality] = useState(editing ? agent.systemPrompt : "");
  const [language, setLanguage] = useState(
    agent?.language ?? firstTemplate?.language ?? initialRuntime?.languages[0] ?? "english"
  );
  const [voice, setVoice] = useState(agent?.voice ?? firstTemplate?.voice ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewPending, setPreviewPending] = useState(false);

  const runtime = useMemo(
    () => runtimes.find((entry) => entry.name === template?.runtimeName) ?? runtimes[0],
    [runtimes, template]
  );
  const languages = runtime?.languages ?? [];
  const voiceChoices = useMemo(() => {
    const values = new Set(PERSONALITY_TEMPLATES.map((entry) => entry.voice));
    return [...values];
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl !== "") URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function chooseTemplate(id: string): void {
    setTemplateId(id);
    setMessage(null);
    const next = findPersonalityTemplate(id);
    if (next === undefined) return;
    setName(next.name);
    setLanguage(next.language);
    setVoice(next.voice);
    if (runtime !== undefined && !runtime.languages.includes(next.language)) {
      setLanguage(runtime.languages[0] ?? next.language);
    }
  }

  async function preview(voiceOverride?: string, ovcOverride?: unknown): Promise<void> {
    const previewVoice = (voiceOverride ?? voice).trim();
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
          ...(ovcOverride === undefined && template?.ovc === undefined
            ? {}
            : { ovc: ovcOverride ?? template?.ovc }),
          text:
            language === "vietnamese"
              ? "Xin chào, đây là giọng nói của bạn."
              : "Hello, this is how I sound.",
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
    const prompt = template?.prompt ?? personality.trim();
    if (prompt === "" || name.trim() === "") {
      setMessage({ tone: "error", text: strings.personality.refused });
      return;
    }
    if (runtime === undefined) {
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
      name: name.trim(),
      systemPrompt: prompt,
      runtimeId: runtime.id,
      language,
      answerMode: agent?.answerMode ?? "generate",
      // An owner answers on the deployment's built-ins. An administrator keeps
      // whatever the advanced form chose.
      llmProfileId: isAdmin ? (agent?.llmProfileId ?? defaults.llm) : defaults.llm,
      sttProfileId: isAdmin ? (agent?.sttProfileId ?? defaults.stt) : defaults.stt,
      ttsProfileId: isAdmin ? (agent?.ttsProfileId ?? defaults.tts) : defaults.tts,
      voice: voice.trim() === "" ? null : voice.trim(),
      ovcConfig: template?.ovc ?? agent?.ovcConfig ?? null,
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
    <form onSubmit={save} className="mt-4 max-w-2xl">
      {!editing && (
        <fieldset className="mt-2">
          <legend className="text-sm font-medium">{strings.personality.templateHeading}</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {PERSONALITY_TEMPLATES.map((entry) => {
              const selected = entry.id === templateId;
              return (
                <div
                  key={entry.id}
                  className={`rounded border p-3 ${
                    selected
                      ? "border-zinc-900 dark:border-zinc-100"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => chooseTemplate(entry.id)}
                    className="text-left"
                  >
                    <span className="block text-sm font-medium">{entry.name}</span>
                    <span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-400">
                      {entry.description}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mt-2 text-xs underline"
                    disabled={previewPending}
                    onClick={() => void preview(entry.voice)}
                  >
                    {previewPending ? strings.personality.previewing : strings.personality.preview}
                  </button>
                </div>
              );
            })}
            <div
              className={`rounded border p-3 ${
                templateId === "custom"
                  ? "border-zinc-900 dark:border-zinc-100"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <button type="button" onClick={() => chooseTemplate("custom")} className="text-left">
                <span className="block text-sm font-medium">{strings.personality.custom}</span>
              </button>
            </div>
          </div>
        </fieldset>
      )}

      <label className="mt-4 block text-sm">
        {strings.personality.name}
        <input
          className={field}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>

      {templateId === "custom" && (
        <label className="mt-3 block text-sm">
          {strings.personality.customHeading}
          <textarea
            className={`${field} min-h-32`}
            value={personality}
            onChange={(event) => setPersonality(event.target.value)}
            placeholder={strings.personality.customPlaceholder}
            required
          />
        </label>
      )}

      <label className="mt-3 block text-sm">
        {strings.personality.language}
        <select
          className={field}
          value={languages.includes(language) ? language : (languages[0] ?? "")}
          onChange={(event) => setLanguage(event.target.value)}
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
          className={field}
          value={voice}
          onChange={(event) => setVoice(event.target.value)}
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

      <div className="mt-3 flex flex-wrap items-center gap-3">
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
