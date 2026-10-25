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
export interface ProfileValue {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  temperature: number | null;
}

/**
 * The key is write-only: it is typed here and never read back. On an edit,
 * leaving it blank keeps the stored one, which is why the field says so rather
 * than showing a placeholder that could be mistaken for the real key.
 */
export function LlmProfileForm({ profile }: { profile?: ProfileValue }) {
  const strings = useStrings();
  const router = useRouter();
  const editing = profile !== undefined;

  const [name, setName] = useState(profile?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(profile?.baseUrl ?? "");
  const [model, setModel] = useState(profile?.model ?? "");
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
      name,
      baseUrl,
      model,
      apiKey,
      temperature: temperature === "" ? null : Number(temperature),
    };
    const answer = editing
      ? await sendJson(`/api/llm-profiles/${profile!.id}`, body, "PATCH")
      : await sendJson("/api/llm-profiles", body);

    setPending(false);
    if (!answer.ok) {
      setMessage({ tone: "error", text: `${strings.llmProfiles.refused} ${answer.message}`.trim() });
      return;
    }
    if (editing) {
      setApiKey("");
      setMessage({ tone: "ok", text: strings.llmProfiles.saved });
      router.refresh();
      return;
    }
    router.push("/llm-profiles");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-4 max-w-2xl">
      <label className="mt-3 block text-sm">
        {strings.llmProfiles.name}
        <input className={field} value={name} onChange={(event) => setName(event.target.value)} required />
      </label>

      <label className="mt-3 block text-sm">
        {strings.llmProfiles.baseUrl}
        <input
          className={field}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.openai.com/v1"
          required
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          {strings.llmProfiles.model}
          <input className={field} value={model} onChange={(event) => setModel(event.target.value)} required />
        </label>

        <label className="block text-sm">
          {strings.llmProfiles.temperature}
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
      </div>

      <label className="mt-3 block text-sm">
        {strings.llmProfiles.apiKey}
        <input
          className={field}
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          required={!editing}
        />
        {editing && <span className="text-xs text-zinc-500 dark:text-zinc-400">{strings.llmProfiles.apiKeyKeep}</span>}
      </label>

      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{strings.llmProfiles.note}</p>

      <button className={button} disabled={pending}>
        {strings.llmProfiles.save}
      </button>

      {message !== null && <Notice tone={message.tone}>{message.text}</Notice>}
    </form>
  );
}
