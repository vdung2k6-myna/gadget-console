"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/Notice";
import { sendJson } from "@/lib/ui/client";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "mt-2 rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
const danger =
  "mt-2 rounded border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950";

interface Props {
  deviceId: string;
  name: string;
  agentId: string | null;
  partnerDeviceId: string | null;
  agents: { id: string; name: string }[];
  others: { id: string; label: string }[];
  /** Where the actions go: the owner's route by default, the admin's on an admin page. */
  endpoint?: string;
  /** Where a release returns to. */
  redirectTo?: string;
  /** What the release confirmation says; the owner's page uses the dictionary's own. */
  releaseConfirm?: string;
}

/**
 * Everything an owner can change about one device. Each action posts to the
 * route the product already ships and refreshes the page, so what is shown after
 * it is what the console stored — not a local guess about it.
 */
export function DeviceActions({
  deviceId,
  name,
  agentId,
  partnerDeviceId,
  agents,
  others,
  endpoint = `/api/devices/${deviceId}`,
  redirectTo = "/devices",
  releaseConfirm,
}: Props) {
  const strings = useStrings();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(name);
  const [agent, setAgent] = useState(agentId ?? "");
  const [partner, setPartner] = useState(partnerDeviceId ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function patch(body: Record<string, unknown>, okText = strings.device.saved) {
    setPending(true);
    setMessage(null);
    const answer = await sendJson(endpoint, body, "PATCH");
    setPending(false);
    setMessage({ tone: answer.ok ? "ok" : "error", text: answer.ok ? okText : answer.message || strings.common.unexpected });
    if (answer.ok) router.refresh();
  }

  async function release() {
    if (!window.confirm(releaseConfirm ?? strings.device.releaseConfirm)) return;
    setPending(true);
    setMessage(null);
    const answer = await sendJson(endpoint, undefined, "DELETE");
    setPending(false);
    if (answer.ok) {
      router.push(redirectTo);
      router.refresh();
      return;
    }
    setMessage({ tone: "error", text: answer.message || strings.common.unexpected });
  }

  return (
    <div className="mt-6 grid gap-6 sm:grid-cols-2">
      <section className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">{strings.device.rename}</h2>
        <input className={field} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        <button className={button} disabled={pending} onClick={() => patch({ name: displayName })}>
          {strings.device.save}
        </button>
      </section>

      <section className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">{strings.device.agent}</h2>
        <select className={field} value={agent} onChange={(event) => setAgent(event.target.value)}>
          <option value="">{strings.device.none}</option>
          {agents.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <button className={button} disabled={pending} onClick={() => patch({ agentId: agent === "" ? null : agent })}>
          {strings.device.bindAgent}
        </button>
        {agentId !== null && (
          <button className={button} disabled={pending} onClick={() => { setAgent(""); void patch({ agentId: null }); }}>
            {strings.device.unbindAgent}
          </button>
        )}
      </section>

      <section className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">{strings.device.partner}</h2>
        <select className={field} value={partner} onChange={(event) => setPartner(event.target.value)}>
          <option value="">{strings.device.none}</option>
          {others.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <button className={button} disabled={pending} onClick={() => patch({ partnerDeviceId: partner === "" ? null : partner })}>
          {strings.device.pair}
        </button>
        {partnerDeviceId !== null && (
          <button className={button} disabled={pending} onClick={() => { setPartner(""); void patch({ partnerDeviceId: null }); }}>
            {strings.device.unpair}
          </button>
        )}
      </section>

      <section className="rounded border border-red-200 p-4 dark:border-red-900">
        <h2 className="text-sm font-semibold">{strings.device.release}</h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{strings.device.releaseConfirm}</p>
        <button className={danger} disabled={pending} onClick={release}>
          {strings.device.release}
        </button>
      </section>

      {message !== null && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}
