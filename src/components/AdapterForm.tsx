"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/ui/client";
import { useStrings } from "./LocaleProvider";
import type { AdminStrings } from "@/lib/i18n/admin-strings";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

/**
 * Registering a reseller adapter.
 *
 * The endpoint is HTTPS and its token is issued by the console; the response is
 * the only place the plaintext token exists, so the form keeps it on screen
 * until the admin moves on.
 */
export function AdapterForm({ labels }: { labels: AdminStrings["adapters"] }) {
  const strings = useStrings();
  const router = useRouter();
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [kinds, setKinds] = useState<string[]>(["llm"]);
  const [operator, setOperator] = useState("");
  const [region, setRegion] = useState("");
  const [receives, setReceives] = useState<string[]>(["text"]);
  const [retentionDays, setRetentionDays] = useState("");
  const [remote, setRemote] = useState(true);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((entry) => entry !== value)
      : [...list, value];
  }

  async function register(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setToken("");

    const answer = await sendJson("/api/admin/adapters", {
      name,
      endpoint,
      kinds,
      privacy: {
        ...(operator === "" ? {} : { operator }),
        ...(region === "" ? {} : { region }),
        receives,
        remote,
        retentionDays: retentionDays === "" ? null : Number(retentionDays),
      },
    });
    setPending(false);
    if (!answer.ok) {
      setMessage(`${labels.registerFailed} ${answer.message}`.trim());
      return;
    }

    const data = answer.data as { token?: unknown } | undefined;
    setToken(typeof data?.token === "string" ? data.token : "");
    setName("");
    setEndpoint("");
    setOperator("");
    setRegion("");
    setRetentionDays("");
    setMessage(strings.providerProfiles.saved);
    router.refresh();
  }

  return (
    <form onSubmit={register} className="mt-4 max-w-2xl">
      <label className="mt-3 block text-sm">
        {labels.name}
        <input className={field} value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="mt-3 block text-sm">
        {labels.endpoint}
        <input
          className={field}
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder="https://adapter.example/v1"
          required
        />
      </label>
      <fieldset className="mt-3 text-sm">
        <legend className="font-medium">{labels.kinds}</legend>
        {(
          [
            ["llm", labels.kindLlm],
            ["stt", labels.kindStt],
            ["tts", labels.kindTts],
          ] as const
        ).map(([kind, label]) => (
          <label key={kind} className="mt-1 mr-4 inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={kinds.includes(kind)}
              onChange={() => setKinds((current) => toggle(current, kind))}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="mt-3 text-sm">
        <legend className="font-medium">{labels.privacy}</legend>
        <label className="mt-2 block">
          {labels.operator}
          <input className={field} value={operator} onChange={(event) => setOperator(event.target.value)} />
        </label>
        <label className="mt-2 block">
          {labels.region}
          <input className={field} value={region} onChange={(event) => setRegion(event.target.value)} />
        </label>
        <div className="mt-2">
          <span className="font-medium">{labels.receives}</span>
          {(
            [
              ["text", labels.receivesText],
              ["audio", labels.receivesAudio],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="mt-1 mr-4 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={receives.includes(value)}
                onChange={() => setReceives((current) => toggle(current, value))}
              />
              {label}
            </label>
          ))}
        </div>
        <label className="mt-2 block">
          {labels.retentionDays}
          <input
            className={field}
            type="number"
            min={0}
            value={retentionDays}
            onChange={(event) => setRetentionDays(event.target.value)}
          />
        </label>
        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" checked={remote} onChange={(event) => setRemote(event.target.checked)} />
          {labels.remote}
        </label>
      </fieldset>

      <button className={button} disabled={pending}>
        {labels.register}
      </button>

      {message !== "" && <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{message}</p>}
      {token !== "" && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium">{labels.tokenOnce}</p>
          <pre className="mt-1 overflow-x-auto font-mono text-xs">{token}</pre>
          <p className="mt-1 text-xs">{labels.tokenNotice}</p>
        </div>
      )}
    </form>
  );
}
