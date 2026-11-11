"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/ui/client";
import type { SelectableAdapter } from "@/lib/provider-profiles";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

type Kind = "llm" | "stt" | "tts";
type Shape = "direct" | "adapter";

/**
 * Publishing a built-in for the whole tenant.
 *
 * The same rules and the same two shapes as an account profile, plus the
 * tenant-wide default: the server encrypts a direct profile's key, checks the
 * kind's fields and clears the previous default for that kind in this tenant.
 * An adapter-backed built-in stores no key; the adapter holds it.
 */
export function TenantBuiltinForm({ adapters }: { adapters: SelectableAdapter[] }) {
  const strings = useStrings();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("tts");
  const [shape, setShape] = useState<Shape>("adapter");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [adapterId, setAdapterId] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [voice, setVoice] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const adaptersForKind = adapters.filter((adapter) => adapter.kinds.includes(kind));
  const selectedAdapter = adaptersForKind.some((adapter) => adapter.id === adapterId)
    ? adapterId
    : "";
  // Speech is reseller-hosted through an adapter; there is no direct speech
  // shape for a tenant built-in. An llm built-in may still be direct.
  const effectiveShape: Shape = kind === "llm" ? shape : "adapter";

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    let config: Record<string, unknown> | null = null;
    if (effectiveShape === "adapter") {
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

    const answer = await sendJson("/api/admin/provider-profiles", {
      kind,
      name,
      baseUrl: effectiveShape === "direct" ? baseUrl : "",
      model: effectiveShape === "direct" ? model : "",
      adapterId: effectiveShape === "adapter" ? selectedAdapter : "",
      config: effectiveShape === "adapter" ? config : null,
      voice: kind === "tts" ? voice : "",
      temperature:
        effectiveShape === "direct" && kind === "llm" && temperature !== ""
          ? Number(temperature)
          : null,
      apiKey: effectiveShape === "direct" ? apiKey : "",
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
    setShape("adapter");
    setBaseUrl("");
    setModel("");
    setAdapterId("");
    setConfigText("{}");
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
          onChange={(event) => {
            const next = event.target.value as Kind;
            setKind(next);
            if (next !== "llm") setShape("adapter");
          }}
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

      {kind === "llm" ? (
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
      ) : (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {strings.providerProfiles.speechAdapterOnly}
        </p>
      )}

      {effectiveShape === "direct" ? (
        <>
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
          <input
            className={field}
            value={voice}
            onChange={(event) => setVoice(event.target.value)}
            required
          />
        </label>
      )}

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
