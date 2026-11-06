"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/ui/client";
import {
  DEFAULT_TTS_ENGINE,
  VOICE_STYLE_PRESETS,
  defaultNameFor,
  defaultPromptFor,
  defaultVoiceFor,
  rehearsalTextFor,
  sameVoiceConfig,
  voiceStyleFor,
  type VoiceStyle,
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

/** One of the account's gadgets, with the personality that answers it now. */
export interface GadgetOption {
  id: string;
  label: string;
  agentId: string | null;
  agent: AgentValue | null;
}

interface Props {
  runtimes: RuntimeOption[];
  defaults: PersonalityDefaults;
  gadgets: GadgetOption[];
  initialGadgetId?: string;
  /** The setup form picks a gadget; the personality edit form does not. */
  showGadgets?: boolean;
  showAdvanced?: boolean;
  agent?: AgentValue;
  isAdmin: boolean;
  onAdvanced?: () => void;
}

/**
 * The owner's form: choose the gadget, then its language and voice.
 *
 * Selecting a gadget loads the config its active personality already has, so
 * "Hear it" plays what the gadget is set to. Saving updates that personality (or
 * creates one when the gadget has none) and binds it to the chosen gadget. The
 * deployment provides the engine and a default voice per language; the owner may
 * type another, hears it, and never meets a provider or a key.
 */
export function PersonalityForm({
  runtimes,
  defaults,
  gadgets,
  initialGadgetId,
  showGadgets = true,
  showAdvanced = true,
  agent,
  isAdmin,
  onAdvanced,
}: Props) {
  const strings = useStrings();
  const router = useRouter();
  const editing = agent !== undefined;

  const initialGadget =
    (agent === undefined ? undefined : gadgets.find((entry) => entry.agentId === agent.id)) ??
    (initialGadgetId === undefined
      ? undefined
      : gadgets.find((entry) => entry.id === initialGadgetId)) ??
    gadgets[0];
  const initialAgent = agent ?? initialGadget?.agent ?? undefined;

  const [gadgetId, setGadgetId] = useState<string>(initialGadget?.id ?? "");
  const [language, setLanguage] = useState(initialAgent?.language ?? "english");
  const [voice, setVoice] = useState(
    initialAgent?.voice ?? defaultVoiceFor(initialAgent?.language ?? "english")
  );
  const [style, setStyle] = useState<VoiceStyle>(voiceStyleFor(initialAgent?.ovcConfig ?? null));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [savedAgentId, setSavedAgentId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewPending, setPreviewPending] = useState(false);

  const gadget = showGadgets ? gadgets.find((entry) => entry.id === gadgetId) : undefined;
  // The personality this form speaks for: the one being edited, or the chosen
  // gadget's active personality.
  const baseAgent = agent ?? gadget?.agent ?? undefined;
  // A personality shared by several gadgets: editing one of them copies it, so
  // the others keep the voice they have.
  const sharedCount =
    gadget?.agentId === null || gadget?.agentId === undefined
      ? 0
      : gadgets.filter((entry) => entry.agentId === gadget.agentId).length;
  const styleConfig =
    style === "custom" ? (baseAgent?.ovcConfig ?? null) : VOICE_STYLE_PRESETS[style];
  const ovcChanged = !sameVoiceConfig(styleConfig, gadget?.agent?.ovcConfig ?? null);
  const copyForGadget =
    agent === undefined && gadget?.agent != null && sharedCount > 1 && ovcChanged;

  const runtime = useMemo(
    () => runtimes.find((entry) => entry.id === baseAgent?.runtimeId) ?? runtimes[0],
    [runtimes, baseAgent?.runtimeId]
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

  /** Choosing a gadget loads the voice that gadget already has, ready to hear. */
  function chooseGadget(id: string): void {
    setGadgetId(id);
    setSavedAgentId(null);
    setMessage(null);
    if (editing) return; // the personality being edited keeps its own values
    const next = gadgets.find((entry) => entry.id === id)?.agent;
    if (next !== undefined && next !== null) {
      setLanguage(next.language);
      setVoice(next.voice ?? defaultVoiceFor(next.language));
      setStyle(voiceStyleFor(next.ovcConfig));
    } else {
      setLanguage("english");
      setVoice(defaultVoiceFor("english"));
      setStyle("inherit");
    }
  }

  function chooseLanguage(next: string): void {
    setLanguage(next);
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
          ttsProfileId: isAdmin ? (baseAgent?.ttsProfileId ?? defaults.tts) : defaults.tts,
          voice: previewVoice,
          ...(styleConfig === null ? {} : { ovc: styleConfig }),
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
      name:
        copyForGadget && baseAgent !== undefined && gadget !== undefined
          ? `${baseAgent.name} (${gadget.label})`
          : baseAgent?.name ?? defaultNameFor(language),
      systemPrompt: baseAgent?.systemPrompt ?? defaultPromptFor(language),
      runtimeId: runtime.id,
      language,
      answerMode: baseAgent?.answerMode ?? "generate",
      llmProfileId: isAdmin ? (baseAgent?.llmProfileId ?? defaults.llm) : defaults.llm,
      sttProfileId: isAdmin ? (baseAgent?.sttProfileId ?? defaults.stt) : defaults.stt,
      ttsProfileId: isAdmin ? (baseAgent?.ttsProfileId ?? defaults.tts) : defaults.tts,
      voice: voice.trim() === "" ? null : voice.trim(),
      ovcConfig: styleConfig ?? null,
      topics: baseAgent?.topics ?? [],
    };

    const targetId =
      agent?.id ??
      (copyForGadget ? (savedAgentId ?? null) : (gadget?.agent?.id ?? savedAgentId ?? null));
    const answer =
      targetId === null
        ? await sendJson("/api/agents", body)
        : await sendJson(`/api/agents/${targetId}`, body, "PATCH");

    if (!answer.ok) {
      setPending(false);
      setMessage({ tone: "error", text: `${strings.personality.refused} ${answer.message}`.trim() });
      return;
    }

    let savedId = targetId;
    if (savedId === null) {
      savedId = (answer.data as { agent?: { id?: string } } | undefined)?.agent?.id ?? null;
    }
    setSavedAgentId(savedId);

    // The gadget choice is the assignment: bind the saved personality to it.
    if (gadget !== undefined && savedId !== null && gadget.agentId !== savedId) {
      const bound = await sendJson(`/api/devices/${gadget.id}`, { agentId: savedId }, "PATCH");
      if (!bound.ok) {
        setPending(false);
        setMessage({
          tone: "error",
          text: `${strings.personality.assignFailed} ${bound.message}`.trim(),
        });
        return;
      }
    }

    setPending(false);
    setMessage({ tone: "ok", text: strings.personality.saved });
    router.refresh();
  }

  if (runtimes.length === 0 || languages.length === 0) {
    return <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{strings.personality.noRuntime}</p>;
  }

  return (
    <form onSubmit={save} className="mt-3 max-w-xl">
      {showGadgets && (
        <label className="mt-2 block text-sm">
          {strings.personality.useOnGadget}
          <select
            className={field}
            value={gadgetId}
            onChange={(event) => chooseGadget(event.target.value)}
          >
            {gadgets.length === 0 ? (
              <option value="">{strings.personality.answersNone}</option>
            ) : (
              gadgets.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))
            )}
          </select>
        </label>
      )}

      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        {showGadgets ? strings.personality.voiceIntro : strings.personality.voiceIntroEdit}
      </p>
      {showGadgets && sharedCount > 1 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {strings.personality.sharedHint}
        </p>
      )}

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

      <label className="mt-3 block text-sm">
        {strings.personality.ovcStyle}
        <select
          className={field}
          value={style}
          onChange={(event) => {
            setStyle(event.target.value as VoiceStyle);
            setPreviewError("");
            setMessage(null);
          }}
        >
          <option value="inherit">{strings.personality.ovcInherit}</option>
          <option value="off">{strings.personality.ovcOff}</option>
          <option value="natural">{strings.personality.ovcNatural}</option>
          <option value="deep">{strings.personality.ovcDeep}</option>
          <option value="monster">{strings.personality.ovcMonster}</option>
          {style === "custom" && (
            <option value="custom">{strings.personality.ovcCustom}</option>
          )}
        </select>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={secondary} disabled={previewPending} onClick={() => void preview()}>
          {previewPending ? strings.personality.previewing : strings.personality.preview}
        </button>
        <button type="submit" className={primary} disabled={pending}>
          {pending ? strings.personality.saving : strings.personality.save}
        </button>
        {showAdvanced && onAdvanced !== undefined && (
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
      {message !== null && message.tone === "error" && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300">{message.text}</p>
      )}
      {savedAgentId !== null && message?.tone === "ok" && (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
          {strings.personality.saved}
          {gadget === undefined ? "" : ` — ${gadget.label}. ${strings.personality.appliesOnReconnect}`}
        </p>
      )}
    </form>
  );
}
