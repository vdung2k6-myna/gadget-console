"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/ui/client";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

type Kind = "llm" | "stt" | "tts";

/**
 * Publishing a built-in for the whole tenant.
 *
 * The same rules as an account profile, plus the tenant-wide default: the server
 * encrypts the key, checks the kind's fields and clears the previous default for
 * that kind in this tenant.
 */
export function TenantBuiltinForm() {
  const strings = useStrings();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("tts");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [voice, setVoice] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const answer = await sendJson("/api/admin/provider-profiles", {
      kind,
      name,
      baseUrl,
      model,
      voice: kind === "tts" ? voice : "",
      temperature: kind === "llm" && temperature !== "" ? Number(temperature) : null,
      apiKey,
      default: isDefault,
    });

    setPending(false);
    if (!answer.ok) {
      setMessage({
        tone: "error",
        text: `${strings.providerProfiles.refused} ${answer.message}`.trim(),
      });
      return;
    }

    setName("");
    setBaseUrl("");
    setModel("");
    setVoice("");
    setApiKey("");
    setTemperature("");
    setIsDefault(false);
    setMessage({ tone: "ok", text: strings.providerProfiles.saved });
    router.refresh();
  }

  return (
    <form onSubmit={publish} className="mt-6 max-w-2xl">
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

      <label className="mt-3 block text-sm">
        {strings.providerProfiles.name}
        <input
          className={field}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>

      <label className="mt-3 block text-sm">
        {strings.providerProfiles.baseUrl}
        <input
          className={field}
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          required
        />
      </label>

      <label className="mt-3 block text-sm">
        {strings.providerProfiles.model}
        <input
          className={field}
          value={model}
          onChange={(event) => setModel(event.target.value)}
          required
        />
      </label>

      {kind === "llm" && (
        <label className="mt-3 block text-sm">
          {strings.providerProfiles.temperature}
          <input
            className={field}
            value={temperature}
            onChange={(event) => setTemperature(event.target.value)}
            inputMode="decimal"
          />
        </label>
      )}

      {kind === "tts" && (
        <label className="mt-3 block text-sm">
          {strings.providerProfiles.voice}
          <input
            className={field}
            value={voice}
            onChange={(event) => setVoice(event.target.value)}
            required
          />
        </label>
      )}

      <label className="mt-3 block text-sm">
        {strings.providerProfiles.apiKey}
        <input
          className={field}
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          required={kind === "llm"}
          autoComplete="off"
        />
      </label>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(event) => setIsDefault(event.target.checked)}
        />
        {strings.providerProfiles.defaultLabel}
      </label>

      <button className={button} disabled={pending}>
        {pending ? strings.providerProfiles.save : strings.providerProfiles.publish}
      </button>

      {message !== null && (
        <p
          role="alert"
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
