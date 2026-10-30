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

type Kind = "llm" | "stt" | "tts";

export interface ProviderProfileValue {
  id: string;
  kind: Kind;
  name: string;
  baseUrl: string;
  model: string;
  voice: string | null;
  temperature: number | null;
}

/**
 * One form for all three kinds.
 *
 * The fields that belong to a kind are the only ones it shows: a voice for
 * `tts`, a temperature for `llm`. The server refuses a field of another kind
 * rather than storing one it would ignore.
 *
 * The key is write-only: it is typed here and never read back. On an edit,
 * leaving it blank keeps the stored one, which is why the field says so rather
 * than showing a placeholder that could be mistaken for the real key.
 */
export function ProviderProfileForm({
  profile,
  fixedKind,
}: {
  profile?: ProviderProfileValue;
  /** Set when the page owns the kind, as the answering-model pages do. */
  fixedKind?: Kind;
}) {
  const strings = useStrings();
  const router = useRouter();
  const editing = profile !== undefined;

  const [kind, setKind] = useState<Kind>(fixedKind ?? profile?.kind ?? "tts");
  const [name, setName] = useState(profile?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? "");
  const [model, setModel] = useState(profile?.model ?? "");
  const [voice, setVoice] = useState(profile?.voice ?? "");
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState(
    profile?.temperature === null || profile?.temperature === undefined ? "" : String(profile.temperature)
  );
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const body = {
      kind: fixedKind ?? kind,
      name,
      baseUrl,
      model,
      voice: kind === "tts" ? voice : "",
      temperature: kind === "llm" && temperature !== "" ? Number(temperature) : null,
      apiKey,
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

      {kind === "tts" && (
        <label className="mt-3 block text-sm">
          {strings.providerProfiles.voice}
          <input className={field} value={voice} onChange={(event) => setVoice(event.target.value)} required />
        </label>
      )}

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

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{strings.providerProfiles.note}</p>

      <button className={button} disabled={pending}>
        {strings.providerProfiles.save}
      </button>

      {message !== null && <Notice tone={message.tone}>{message.text}</Notice>}
    </form>
  );
}
