"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/Notice";
import { sendJson } from "@/lib/ui/client";
import {
  OFFLINE_F0_METHODS,
  OVC_EFFECT_KEYS,
  type AgentVoiceConversion,
} from "@/lib/agent-voice-conversion";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const danger =
  "mt-3 rounded border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950";

/**
 * The shaping presets, as values rather than labels. Labels live in the
 * dictionaries; a preset fills the form and the operator may then edit it.
 */
const OVC_PRESETS: Record<
  string,
  {
    pitchShift: number;
    formantShift: number;
    f0Method: string;
    effects: Record<string, Record<string, unknown>>;
  }
> = {
  clean: { pitchShift: 0, formantShift: 0, f0Method: "pm", effects: {} },
  baby: { pitchShift: 12, formantShift: 10, f0Method: "rmvpe", effects: {} },
  "baby-soft": { pitchShift: 9, formantShift: 8, f0Method: "rmvpe", effects: {} },
  chipmunk: { pitchShift: 7, formantShift: 4, f0Method: "pm", effects: {} },
  helium: { pitchShift: 3, formantShift: 7, f0Method: "pm", effects: {} },
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
  /** Its voice conversion, or null to inherit the deployment's. */
  ovcConfig: AgentVoiceConversion | null;
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
  const llmProfiles = profiles.filter((profile) => profile.kind === "llm");
  // No empty option and no default: an agent that names no model has nothing to
  // answer it, so a new agent starts on the first model the account configured.
  const [llmProfileId, setLlmProfileId] = useState(agent?.llmProfileId ?? llmProfiles[0]?.id ?? "");
  const [sttProfileId, setSttProfileId] = useState(agent?.sttProfileId ?? "");
  const [ttsProfileId, setTtsProfileId] = useState(agent?.ttsProfileId ?? "");
  const [voice, setVoice] = useState(agent?.voice ?? "");
  const [voiceState, setVoiceState] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [answerMode, setAnswerMode] = useState(agent?.answerMode ?? "generate");
  const [topics, setTopics] = useState((agent?.topics ?? []).join("\n"));
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const initialConversion = agent?.ovcConfig ?? null;
  const [ovcMode, setOvcMode] = useState<"inherit" | "off" | "custom">(
    initialConversion === null
      ? "inherit"
      : initialConversion.enabled === false
        ? "off"
        : "custom"
  );
  const [ovcPreset, setOvcPreset] = useState("custom");
  const [ovcPitch, setOvcPitch] = useState(initialConversion?.pitchShift ?? 0);
  const [ovcFormant, setOvcFormant] = useState(initialConversion?.formantShift ?? 0);
  const [ovcF0, setOvcF0] = useState(initialConversion?.f0Method ?? "pm");
  const [ovcIndexRate, setOvcIndexRate] = useState(initialConversion?.indexRate ?? 0.75);
  const [ovcProtect, setOvcProtect] = useState(initialConversion?.protect ?? 0.33);
  const [ovcRmsMix, setOvcRmsMix] = useState(initialConversion?.rmsMixRate ?? 0.25);
  const [ovcFilterRadius, setOvcFilterRadius] = useState(initialConversion?.filterRadius ?? 3);
  const [ovcCrepeHop, setOvcCrepeHop] = useState(initialConversion?.crepeHopLength ?? 160);
  const [ovcEffects, setOvcEffects] = useState<Record<string, Record<string, unknown>>>(
    () => initialConversion?.effects ?? {}
  );

  const runtime = runtimes.find((entry) => entry.id === runtimeId);
  const languageMissing = runtime !== undefined && !runtime.languages.includes(language);

  function optionsFor(kind: ProfileOption["kind"]): ProfileOption[] {
    return profiles.filter((profile) => profile.kind === kind);
  }

  function optionLabel(profile: ProfileOption): string {
    return profile.builtin ? `${profile.name} (${strings.agentForm.builtin})` : profile.name;
  }

  const presetLabels: Record<string, string> = {
    clean: strings.agentForm.ovcPresetClean,
    baby: strings.agentForm.ovcPresetBaby,
    "baby-soft": strings.agentForm.ovcPresetBabySoft,
    chipmunk: strings.agentForm.ovcPresetChipmunk,
    helium: strings.agentForm.ovcPresetHelium,
    deep: strings.agentForm.ovcPresetDeep,
    monster: strings.agentForm.ovcPresetMonster,
  };

  const effectLabels: Record<string, string> = {
    gate: strings.agentForm.ovcEffectGate,
    robot: strings.agentForm.ovcEffectRobot,
    whisper: strings.agentForm.ovcEffectWhisper,
    distortion: strings.agentForm.ovcEffectDistortion,
    bitcrush: strings.agentForm.ovcEffectBitcrush,
    telephone: strings.agentForm.ovcEffectTelephone,
    chorus: strings.agentForm.ovcEffectChorus,
    echo: strings.agentForm.ovcEffectEcho,
    reverb: strings.agentForm.ovcEffectReverb,
    eq: strings.agentForm.ovcEffectEq,
    compressor: strings.agentForm.ovcEffectCompressor,
    gain: strings.agentForm.ovcEffectGain,
  };

  /** Fill the form from a preset; later edits mark the choice as custom. */
  function applyOvcPreset(name: string): void {
    setOvcPreset(name);
    const preset = OVC_PRESETS[name];
    if (preset === undefined) return;
    setOvcPitch(preset.pitchShift);
    setOvcFormant(preset.formantShift);
    setOvcF0(preset.f0Method);
    setOvcEffects(
      JSON.parse(JSON.stringify(preset.effects)) as Record<string, Record<string, unknown>>
    );
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
      ovcConfig:
        ovcMode === "inherit"
          ? null
          : ovcMode === "off"
            ? { enabled: false }
            : {
                pitchShift: ovcPitch,
                formantShift: ovcFormant,
                f0Method: ovcF0,
                indexRate: ovcIndexRate,
                protect: ovcProtect,
                rmsMixRate: ovcRmsMix,
                filterRadius: ovcFilterRadius,
                crepeHopLength: ovcCrepeHop,
                effects: ovcEffects,
              },
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

  if (llmProfiles.length === 0) {
    return (
      <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
        {strings.agentForm.noProfiles}{" "}
        <Link href="/provider-profiles/new" className="underline">
          {strings.providerProfiles.createModel}
        </Link>
      </p>
    );
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

      <fieldset className="mt-4 rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium">{strings.agentForm.voiceConversion}</legend>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {strings.agentForm.voiceConversionHint}
        </p>

        <label className="mt-3 block text-sm">
          {strings.agentForm.ovcMode}
          <select
            className={field}
            value={ovcMode}
            onChange={(event) =>
              setOvcMode(event.target.value as "inherit" | "off" | "custom")
            }
          >
            <option value="inherit">{strings.agentForm.ovcInherit}</option>
            <option value="off">{strings.agentForm.ovcOff}</option>
            <option value="custom">{strings.agentForm.ovcCustom}</option>
          </select>
        </label>

        {ovcMode === "off" && (
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {strings.agentForm.ovcOffHint}
          </p>
        )}

        {ovcMode === "custom" && (
          <>
            <label className="mt-3 block text-sm">
              {strings.agentForm.ovcPreset}
              <select
                className={field}
                value={ovcPreset}
                onChange={(event) => applyOvcPreset(event.target.value)}
              >
                <option value="custom">{strings.agentForm.ovcPresetCustom}</option>
                {Object.keys(OVC_PRESETS).map((name) => (
                  <option key={name} value={name}>
                    {presetLabels[name]}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block text-sm">
                {strings.agentForm.ovcPitch}
                <input
                  className={field}
                  type="number"
                  min={-24}
                  max={24}
                  step={0.5}
                  value={ovcPitch}
                  onChange={(event) => {
                    setOvcPreset("custom");
                    setOvcPitch(Number(event.target.value));
                  }}
                />
              </label>
              <label className="block text-sm">
                {strings.agentForm.ovcFormant}
                <input
                  className={field}
                  type="number"
                  min={-24}
                  max={24}
                  step={0.5}
                  value={ovcFormant}
                  onChange={(event) => {
                    setOvcPreset("custom");
                    setOvcFormant(Number(event.target.value));
                  }}
                />
              </label>
            </div>

            <label className="mt-3 block text-sm">
              {strings.agentForm.ovcF0}
              <select
                className={field}
                value={ovcF0}
                onChange={(event) => {
                  setOvcPreset("custom");
                  setOvcF0(event.target.value);
                }}
              >
                {OFFLINE_F0_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>

            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium">
                {strings.agentForm.ovcAdvanced}
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  {strings.agentForm.ovcIndexRate}
                  <input
                    className={field}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={ovcIndexRate}
                    onChange={(event) => {
                      setOvcPreset("custom");
                      setOvcIndexRate(Number(event.target.value));
                    }}
                  />
                </label>
                <label className="block text-sm">
                  {strings.agentForm.ovcProtect}
                  <input
                    className={field}
                    type="number"
                    min={0}
                    max={0.5}
                    step={0.01}
                    value={ovcProtect}
                    onChange={(event) => {
                      setOvcPreset("custom");
                      setOvcProtect(Number(event.target.value));
                    }}
                  />
                </label>
                <label className="block text-sm">
                  {strings.agentForm.ovcRmsMix}
                  <input
                    className={field}
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={ovcRmsMix}
                    onChange={(event) => {
                      setOvcPreset("custom");
                      setOvcRmsMix(Number(event.target.value));
                    }}
                  />
                </label>
                <label className="block text-sm">
                  {strings.agentForm.ovcFilterRadius}
                  <input
                    className={field}
                    type="number"
                    min={0}
                    max={20}
                    step={1}
                    value={ovcFilterRadius}
                    onChange={(event) => {
                      setOvcPreset("custom");
                      setOvcFilterRadius(Number(event.target.value));
                    }}
                  />
                </label>
                <label className="block text-sm">
                  {strings.agentForm.ovcCrepeHop}
                  <input
                    className={field}
                    type="number"
                    min={64}
                    max={512}
                    step={32}
                    value={ovcCrepeHop}
                    onChange={(event) => {
                      setOvcPreset("custom");
                      setOvcCrepeHop(Number(event.target.value));
                    }}
                  />
                </label>
              </div>
            </details>

            <fieldset className="mt-3">
              <legend className="text-sm font-medium">{strings.agentForm.ovcEffects}</legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {OVC_EFFECT_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ovcEffects[key] !== undefined}
                      onChange={(event) => {
                        setOvcPreset("custom");
                        setOvcEffects((current) => {
                          const next = { ...current };
                          if (event.target.checked) next[key] = { enabled: true };
                          else delete next[key];
                          return next;
                        });
                      }}
                    />
                    {effectLabels[key]}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
      </fieldset>

      <label className="mt-3 block text-sm">
        {strings.agentForm.llmProfile}
        <select
          className={field}
          value={llmProfileId}
          onChange={(event) => setLlmProfileId(event.target.value)}
          required
        >
          {llmProfiles.map((profile) => (
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
