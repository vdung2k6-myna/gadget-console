"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/Notice";
import { sendJson } from "@/lib/ui/client";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const danger =
  "mt-3 rounded border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950";

export interface RuntimeOption {
  id: string;
  name: string;
  languages: string[];
}

export interface ProfileOption {
  id: string;
  kind: "llm" | "stt" | "tts";
  name: string;
  builtin: boolean;
}

export interface AgentValue {
  id: string;
  name: string;
  llmProfileId: string | null;
  sttProfileId: string | null;
  ttsProfileId: string | null;
  /** A voice this agent speaks in, or null to use its `tts` profile's. */
  voice: string | null;
  systemPrompt: string;
  language: string;
  runtimeId: string;
  answerMode: string;
  topics: string[];
}

interface Props {
  runtimes: RuntimeOption[];
  profiles: ProfileOption[];
  agent?: AgentValue;
}

/**
 * The one form for creating and editing what a gadget says.
 *
 * It offers the account's answering models and only the languages the chosen
 * runtime names. The transcriber is the account's speech setting; the voice is
 * the provider's unless this agent names one, and the name is checked against
 * that provider before a turn discovers it. The profile ids are carried so
 * saving an agent does not clear links the settings page maintains.
 */
export function AgentForm({ runtimes, profiles, agent }: Props) {
  const strings = useStrings();
  const router = useRouter();
  const editing = agent !== undefined;

  const [name, setName] = useState(agent?.name ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [runtimeId, setRuntimeId] = useState(agent?.runtimeId ?? runtimes[0]?.id ?? "");
  const [language, setLanguage] = useState(agent?.language ?? runtimes[0]?.languages[0] ?? "");
  const [llmProfileId, setLlmProfileId] = useState(agent?.llmProfileId ?? "");
  const [sttProfileId, setSttProfileId] = useState(agent?.sttProfileId ?? "");
  const [ttsProfileId, setTtsProfileId] = useState(agent?.ttsProfileId ?? "");
  const [voice, setVoice] = useState(agent?.voice ?? "");
  const [voiceState, setVoiceState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [answerMode, setAnswerMode] = useState(agent?.answerMode ?? "generate");
  const [topics, setTopics] = useState((agent?.topics ?? []).join("\n"));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const runtime = runtimes.find((entry) => entry.id === runtimeId);
  const languageMissing = runtime !== undefined && !runtime.languages.includes(language);

  function optionsFor(kind: ProfileOption["kind"]): ProfileOption[] {
    return profiles.filter((profile) => profile.kind === kind);
  }

  function optionLabel(profile: ProfileOption): string {
    return profile.builtin ? `${profile.name} (${strings.agentForm.builtin})` : profile.name;
  }

  /** Ask the account's TTS provider whether it holds this voice. */
  async function checkVoice(value: string): Promise<void> {
    if (value.trim() === "") {
      setVoiceState(null);
      return;
    }
    const answer = await sendJson("/api/agents/voice-check", { voice: value.trim() });
    if (!answer.ok) {
      setVoiceState({
        tone: "error",
        text: `${strings.providerProfiles.testFailed} ${answer.message}`.trim(),
      });
      return;
    }
    const result = answer.data as { ok?: boolean; error?: string } | undefined;
    setVoiceState(
      result?.ok === true
        ? { tone: "ok", text: strings.providerProfiles.testOk }
        : {
            tone: "error",
            text: `${strings.providerProfiles.testFailed} ${result?.error ?? ""}`.trim(),
          }
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const body = {
      name,
      systemPrompt,
      runtimeId,
      language,
      answerMode,
      llmProfileId: llmProfileId === "" ? null : llmProfileId,
      sttProfileId: sttProfileId === "" ? null : sttProfileId,
      ttsProfileId: ttsProfileId === "" ? null : ttsProfileId,
      voice: voice.trim() === "" ? null : voice.trim(),
      topics: topics
        .split("\n")
        .map((topic) => topic.trim())
        .filter((topic) => topic !== ""),
    };

    const answer = editing
      ? await sendJson(`/api/agents/${agent.id}`, body, "PATCH")
      : await sendJson("/api/agents", body);

    setPending(false);
    if (!answer.ok) {
      // Every reason the route gave, beside the form, with what was typed kept.
      setMessage({ tone: "error", text: `${strings.agentForm.refused} ${answer.message}`.trim() });
      return;
    }
    if (editing) {
      setMessage({ tone: "ok", text: strings.agentForm.saved });
      router.refresh();
      return;
    }
    router.push("/agents");
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(strings.agentForm.deleteConfirm)) return;
    setPending(true);
    const answer = await sendJson(`/api/agents/${agent!.id}`, undefined, "DELETE");
    setPending(false);
    if (answer.ok) {
      router.push("/agents");
      router.refresh();
      return;
    }
    setMessage({ tone: "error", text: answer.message || strings.common.unexpected });
  }

  if (runtimes.length === 0) {
    return <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{strings.agentForm.noRuntimes}</p>;
  }

  return (
    <form onSubmit={save} className="mt-4 max-w-2xl">
      <label className="mt-3 block text-sm">
        {strings.agentForm.name}
        <input className={field} value={name} onChange={(event) => setName(event.target.value)} required />
      </label>

      <label className="mt-3 block text-sm">
        {strings.agentForm.systemPrompt}
        <textarea
          className={`${field} min-h-40`}
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          required
        />
      </label>

      <label className="mt-3 block text-sm">
        {strings.agentForm.runtime}
        <select
          className={field}
          value={runtimeId}
          onChange={(event) => {
            const next = runtimes.find((entry) => entry.id === event.target.value);
            setRuntimeId(event.target.value);
            if (next !== undefined && !next.languages.includes(language)) {
              setLanguage(next.languages[0] ?? "");
            }
          }}
        >
          {runtimes.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-sm">
        {strings.agentForm.language}
        <select
          className={field}
          value={language}
          onChange={(event) => {
            setLanguage(event.target.value);
            // The voice this agent names may not be one the provider holds for
            // the language it now speaks; ask the provider again, as the
            // settings page does, rather than let a turn discover it.
            if (voice.trim() !== "") void checkVoice(voice);
          }}
        >
          {(runtime?.languages ?? []).map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        {languageMissing && (
          <span className="text-xs text-red-700 dark:text-red-300">
            runtime này không có ngôn ngữ đang chọn
          </span>
        )}
      </label>

      <label className="mt-3 block text-sm">
        {strings.agentForm.voice}
        <input
          className={field}
          value={voice}
          onChange={(event) => {
            setVoice(event.target.value);
            setVoiceState(null);
          }}
          onBlur={(event) => void checkVoice(event.target.value)}
          placeholder="voice-name"
        />
        {voiceState !== null && (
          <span
            className={
              voiceState.tone === "ok"
                ? "text-xs text-emerald-700 dark:text-emerald-300"
                : "text-xs text-red-700 dark:text-red-300"
            }
          >
            {voiceState.text}
          </span>
        )}
      </label>

      <label className="mt-3 block text-sm">
        {strings.agentForm.llmProfile}
        <select
          className={field}
          value={llmProfileId}
          onChange={(event) => setLlmProfileId(event.target.value)}
        >
          <option value="">{strings.agentForm.profileDefault}</option>
          {optionsFor("llm").map((profile) => (
            <option key={profile.id} value={profile.id}>
              {optionLabel(profile)}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-sm">
        {strings.agentForm.answerMode}
        <select className={field} value={answerMode} onChange={(event) => setAnswerMode(event.target.value)}>
          <option value="generate">{strings.agentForm.answerModeGenerate}</option>
          <option value="material">{strings.agentForm.answerModeMaterial}</option>
        </select>
      </label>

      <label className="mt-3 block text-sm">
        {strings.agentForm.topics}
        <textarea className={`${field} min-h-24`} value={topics} onChange={(event) => setTopics(event.target.value)} />
      </label>

      <button className={button} disabled={pending}>
        {editing ? strings.agentForm.save : strings.agentForm.create}
      </button>

      {editing && (
        <button type="button" className={danger} disabled={pending} onClick={remove}>
          {strings.agentForm.delete}
        </button>
      )}

      {message !== null && <Notice tone={message.tone}>{message.text}</Notice>}
    </form>
  );
}
