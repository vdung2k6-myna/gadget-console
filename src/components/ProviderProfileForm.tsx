"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/Notice";
import { sendJson } from "@/lib/ui/client";
import type { SelectableAdapter } from "@/lib/provider-profiles";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

type Kind = "llm" | "stt" | "tts";
type Shape = "direct" | "adapter";

export interface ProviderProfileValue {
  id: string;
  kind: Kind;
  name: string;
  /** The direct shape's endpoint; empty for an adapter-backed profile. */
  baseUrl: string;
  /** The direct shape's model; empty for an adapter-backed profile. */
  model: string;
  /** The registered adapter an adapter-backed profile names; null for direct. */
  adapterId: string | null;
  /** The adapter's opaque config; null for a direct profile. */
  config: Record<string, unknown> | null;
  voice: string | null;
  temperature: number | null;
}

/**
 * One form for all three kinds, and for both shapes.
 *
 * A direct profile is the OpenAI-compatible endpoint the runtime has always
 * called: a base URL, a model and, for an LLM, a key. An adapter-backed profile
 * names a registered adapter and carries the opaque config its manifest
 * declares; the adapter holds the provider key, so this form asks for none.
 *
 * The fields that belong to a kind are the only ones it shows: a voice for
 * `tts`, a temperature for a direct `llm`. The server refuses a field of another
 * kind rather than storing one it would ignore.
 *
 * The key is write-only: it is typed here and never read back. On an edit,
 * leaving it blank keeps the stored one, which is why the field says so rather
 * than showing a placeholder that could be mistaken for the real key.
 */
export function ProviderProfileForm({
  profile,
  fixedKind,
  adapters = [],
}: {
  profile?: ProviderProfileValue;
  /** Set when the page owns the kind, as the answering-model pages do. */
  fixedKind?: Kind;
  /** The adapters this account may name, already scoped to its tenant. */
  adapters?: SelectableAdapter[];
}) {
  const strings = useStrings();
  const router = useRouter();
  const editing = profile !== undefined;

  const [kind, setKind] = useState<Kind>(fixedKind ?? profile?.kind ?? "tts");
  const [shape, setShape] = useState<Shape>(
    profile?.adapterId === null || profile?.adapterId === undefined ? "direct" : "adapter"
  );
  const [name, setName] = useState(profile?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? "");
  const [model, setModel] = useState(profile?.model ?? "");
  const [adapterId, setAdapterId] = useState(profile?.adapterId ?? "");
  const [configText, setConfigText] = useState(
    profile?.config === null || profile?.config === undefined
      ? "{}"
      : JSON.stringify(profile.config, null, 2)
  );
  const [voice, setVoice] = useState(profile?.voice ?? "");
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState(
    profile?.temperature === null || profile?.temperature === undefined ? "" : String(profile.temperature)
  );
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  // An adapter is offered only for a kind it serves, so changing the kind
  // cannot leave the form pointing at an adapter that cannot answer it.
  const adaptersForKind = adapters.filter((adapter) => adapter.kinds.includes(kind));
  const selectedAdapter = adaptersForKind.some((adapter) => adapter.id === adapterId)
    ? adapterId
    : "";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    let config: Record<string, unknown> | null = null;
    if (shape === "adapter") {
      if (selectedAdapter === "") {
        setPending(false);
        setMessage({ tone: "error", text: strings.providerProfiles.adapterRequired });
        return;
      }
      try {
        const parsed: unknown = configText.trim() === "" ? {} : JSON.parse(configText);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("not an object");
        }
        config = parsed as Record<string, unknown>;
      } catch {
        setPending(false);
        setMessage({ tone: "error", text: strings.providerProfiles.configInvalid });
        return;
      }
    }

    const body = {
      kind: fixedKind ?? kind,
      name,
      baseUrl: shape === "direct" ? baseUrl : "",
      model: shape === "direct" ? model : "",
      adapterId: shape === "adapter" ? selectedAdapter : "",
      config: shape === "adapter" ? config : null,
      voice: kind === "tts" ? voice : "",
      temperature:
        shape === "direct" && kind === "llm" && temperature !== ""
          ? Number(temperature)
          : null,
      apiKey: shape === "direct" ? apiKey : "",
    };
    const answer = editing
      ? await sendJson(`/api/provider-profiles/${profile!.id}`, body, "PATCH")
      : await sendJson("/api/provider-profiles", body);

    setPending(false);
    if (!answer.ok) {
      setMessage({ tone: "error", text: `${strings.providerProfiles.refused} ${answer.message}`.trim() });
      return;
    }
    if (editing) {
      setApiKey("");
      setMessage({ tone: "ok", text: strings.providerProfiles.saved });
      router.refresh();
      return;
    }
    router.push("/provider-profiles");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-4 max-w-2xl">
      {fixedKind === undefined && (
        <label className="mt-3 block text-sm">
          {strings.providerProfiles.kind}
          <select
            className={field}
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
          >
            <option value="llm">{strings.providerProfiles.kindLlm}</option>
            <option value="stt">{strings.providerProfiles.kindStt}</option>
            <option value="tts">{strings.providerProfiles.kindTts}</option>
          </select>
        </label>
      )}

      <label className="mt-3 block text-sm">
        {strings.providerProfiles.name}
        <input className={field} value={name} onChange={(event) => setName(event.target.value)} required />
      </label>

      <label className="mt-3 block text-sm">
        {strings.providerProfiles.shape}
        <select
          className={field}
          value={shape}
          onChange={(event) => setShape(event.target.value as Shape)}
        >
          <option value="direct">{strings.providerProfiles.shapeDirect}</option>
          <option value="adapter">{strings.providerProfiles.shapeAdapter}</option>
        </select>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {strings.providerProfiles.shapeHint}
        </span>
      </label>

      {shape === "direct" ? (
        <>
          <label className="mt-3 block text-sm">
            {strings.providerProfiles.baseUrl}
            <input
              className={field}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              required
            />
          </label>

          <label className="mt-3 block text-sm">
            {strings.providerProfiles.model}
            <input className={field} value={model} onChange={(event) => setModel(event.target.value)} required />
          </label>

          {kind === "llm" && (
            <label className="mt-3 block text-sm">
              {strings.providerProfiles.temperature}
              <input
                className={field}
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(event) => setTemperature(event.target.value)}
              />
            </label>
          )}

          <label className="mt-3 block text-sm">
            {strings.providerProfiles.apiKey}
            <input
              className={field}
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              required={!editing && kind === "llm"}
            />
            {editing && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {strings.providerProfiles.apiKeyKeep}
              </span>
            )}
          </label>
        </>
      ) : (
        <>
          <label className="mt-3 block text-sm">
            {strings.providerProfiles.adapter}
            <select
              className={field}
              value={selectedAdapter}
              onChange={(event) => setAdapterId(event.target.value)}
              required
            >
              <option value="">{strings.providerProfiles.adapterChoose}</option>
              {adaptersForKind.map((adapter) => (
                <option key={adapter.id} value={adapter.id}>
                  {adapter.name} · {adapter.status}
                </option>
              ))}
            </select>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {adaptersForKind.length === 0
                ? strings.providerProfiles.adapterNone
                : strings.providerProfiles.adapterHint}
            </span>
          </label>

          <label className="mt-3 block text-sm">
            {strings.providerProfiles.config}
            <textarea
              className={`${field} font-mono`}
              rows={6}
              value={configText}
              onChange={(event) => setConfigText(event.target.value)}
            />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {strings.providerProfiles.configHint}
            </span>
          </label>

          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {strings.providerProfiles.adapterNote}
          </p>
        </>
      )}

      {kind === "tts" && (
        <label className="mt-3 block text-sm">
          {strings.providerProfiles.voice}
          <input className={field} value={voice} onChange={(event) => setVoice(event.target.value)} required />
        </label>
      )}

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{strings.providerProfiles.note}</p>

      <button className={button} disabled={pending}>
        {strings.providerProfiles.save}
      </button>

      {message !== null && <Notice tone={message.tone}>{message.text}</Notice>}
    </form>
  );
}
