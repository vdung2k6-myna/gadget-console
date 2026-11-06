"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/ui/client";
import { useStrings } from "./LocaleProvider";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** Make this personality the active one on one of the account's gadgets. */
export function UseOnGadget({
  agentId,
  devices,
}: {
  agentId: string;
  devices: { id: string; label: string }[];
}) {
  const strings = useStrings();
  const router = useRouter();
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  if (devices.length === 0) {
    return <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{strings.personality.answersNone}</p>;
  }

  async function use(): Promise<void> {
    setPending(true);
    setMessage("");
    setFailed(false);
    const answer = await sendJson(`/api/devices/${deviceId}`, { agentId }, "PATCH");
    setPending(false);
    setFailed(!answer.ok);
    setMessage(answer.ok ? strings.personality.saved : answer.message || strings.common.unexpected);
    if (answer.ok) router.refresh();
  }

  return (
    <div className="mt-3">
      <label className="block text-xs text-zinc-600 dark:text-zinc-400">
        {strings.personality.useOnGadget}
        <select className={field} value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="mt-2 rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        disabled={pending}
        onClick={() => void use()}
      >
        {strings.personality.switchTo}
      </button>
      {message !== "" && (
        <>
          <p className={`mt-1 text-xs ${failed ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
            {message}
          </p>
          {!failed && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {strings.personality.appliesOnReconnect}
            </p>
          )}
        </>
      )}
    </div>
  );
}
