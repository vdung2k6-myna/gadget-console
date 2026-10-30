"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Notice } from "@/components/Notice";
import { sendJson } from "@/lib/ui/client";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";
const secondary =
  "rounded border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

export interface SpeechProfile {
  id: string;
  kind: "stt" | "tts";
  name: string;
  baseUrl: string;
  model: string;
  voice: string | null;
  hasKey: boolean;
  builtin: boolean;
}

interface Props {
  kind: "stt" | "tts";
  own: SpeechProfile | null;
}

/**
 * One speech setting, edited in place.
 *
 * The starting values are the account's own configuration and nothing else: a kind
 * the account has not configured starts empty and has to be filled, because a
 * deployment default is no longer something this console offers. `model` and
 * `voice` are free text: the endpoint defines what their names mean, and the test
 * is how a name is checked. The test calls the endpoint in the form and nothing
 * else, so it still works on a deployment whose own audio services have been
 * deleted.
 */
export function SpeechSettingsForm({ kind, own }: Props) {
  const strings = useStrings();
  const router = useRouter();
  const initial = own;

  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [voice, setVoice] = useState(initial?.voice ?? "");
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const sampleRef = useRef<string | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  /** What the last sample actually asked for, shown beside the player. */
  const [tested, setTested] = useState<{ model: string; voice: string; baseUrl: string } | null>(null);

  const title = kind === "stt" ? strings.providerProfiles.kindStt : strings.providerProfiles.kindTts;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const answer = await sendJson(
      "/api/provider-settings",
      {
        kind,
        baseUrl,
        model,
        voice: kind === "tts" ? voice : "",
        apiKey,
      },
      "PUT"
    );
    setPending(false);
    if (!answer.ok) {
      setMessage({ tone: "error", text: `${strings.providerProfiles.refused} ${answer.message}`.trim() });
      return;
    }
    setApiKey("");
    setMessage({ tone: "ok", text: strings.providerProfiles.saved });
    router.refresh();
  }

  async function test() {
    setTesting(true);
    setMessage(null);
    const answer = await sendJson("/api/provider-settings/test", {
      baseUrl,
      model,
      voice,
      apiKey,
    });
    setTesting(false);
    if (!answer.ok) {
      setMessage({ tone: "error", text: `${strings.providerProfiles.testFailed} ${answer.message}`.trim() });
      return;
    }
    const result = answer.data as { ok: boolean; error?: string; audio?: string; contentType?: string };
    if (!result.ok || result.audio === undefined) {
      setMessage({ tone: "error", text: `${strings.providerProfiles.testFailed} ${result.error ?? ""}`.trim() });
      return;
    }
    const bytes = Uint8Array.from(atob(result.audio), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: result.contentType ?? "audio/wav" }));
    if (sampleRef.current !== null) URL.revokeObjectURL(sampleRef.current);
    sampleRef.current = url;
    setSample(url);
    setTested({ model, voice, baseUrl });
    setMessage({ tone: "ok", text: strings.providerProfiles.testOk });
  }

  return (
    <section className="mt-4 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {own !== null ? strings.providerProfiles.yourConfig : strings.providerProfiles.notConfigured}
        </span>
      </div>

      <form onSubmit={save} className="mt-3 max-w-2xl">
        <label className="mt-2 block text-sm">
          {strings.providerProfiles.baseUrl}
          <input
            className={field}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
            required
          />
        </label>

        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            {strings.providerProfiles.model}
            <input
              className={field}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={kind === "tts" ? "tts-1" : "stt"}
              required
            />
          </label>

          {kind === "tts" && (
            <label className="block text-sm">
              {strings.providerProfiles.voice}
              <input
                className={field}
                value={voice}
                onChange={(event) => setVoice(event.target.value)}
                placeholder="voice-name"
                required
              />
            </label>
          )}
        </div>

        <label className="mt-2 block text-sm">
          {strings.providerProfiles.apiKey}
          <input
            className={field}
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          {own?.hasKey === true && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {strings.providerProfiles.apiKeyKeep}
            </span>
          )}
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className={button} disabled={pending}>
            {strings.providerProfiles.save}
          </button>
          {kind === "tts" && (
            <button type="button" className={secondary} disabled={testing} onClick={test}>
              {testing ? strings.providerProfiles.testing : strings.providerProfiles.test}
            </button>
          )}
        </div>

        {sample !== null && (
          <div className="mt-3">
            {/* Keyed by the sample so a new voice replaces the player rather than
                reusing one whose buffer a browser may keep. */}
            <audio key={sample} className="w-full" controls autoPlay src={sample} />
            {tested !== null && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {strings.providerProfiles.sample}: {tested.model} · {tested.voice} · {tested.baseUrl}
              </p>
            )}
          </div>
        )}
        {message !== null && <Notice tone={message.tone}>{message.text}</Notice>}
      </form>
    </section>
  );
}
