"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Notice } from "@/components/Notice";
import { sendJson } from "@/lib/ui/client";
import { claimErrorKey } from "@/lib/ui/format";
import { useStrings } from "./LocaleProvider";

/**
 * The code the gadget is showing, entered here. Three refusals are told apart
 * because each sends the person somewhere different: retype it, wake the gadget
 * for a new code, or find that somebody else already owns it.
 */
export function ClaimForm() {
  const strings = useStrings();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);

  async function claim(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const answer = await sendJson("/api/claims", { code });
    setPending(false);

    if (answer.ok) {
      setCode("");
      if (answer.status === 202) {
        const device = (answer.data as { device?: { name?: string; deviceId?: string } } | undefined)
          ?.device;
        setWaiting(device?.name ?? device?.deviceId ?? "");
        router.refresh();
        return;
      }
      setMessage({ tone: "ok", text: strings.devices.claimOk });
      router.refresh();
      return;
    }
    const key = claimErrorKey(answer.status);
    setMessage({
      tone: "error",
      text: key === null ? answer.message || strings.common.unexpected : strings.devices[key],
    });
  }

  if (waiting !== null) {
    return (
      <section className="mt-6 rounded border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950">
        <h2 className="text-base font-semibold text-amber-900 dark:text-amber-100">
          {strings.devices.pendingHeading}
        </h2>
        <p className="mt-1 text-sm text-amber-900 dark:text-amber-100">{strings.home.waiting}</p>
        {waiting !== "" && <p className="mt-2 font-mono text-xs text-amber-900 dark:text-amber-100">{waiting}</p>}
      </section>
    );
  }

  return (
    <form onSubmit={claim} className="mt-6 rounded border border-zinc-200 p-5 dark:border-zinc-800">
      <h2 className="text-base font-semibold">{strings.devices.claimHeading}</h2>
      <label className="mt-3 block text-sm">
        {strings.devices.claimLabel}
        <input
          className="mt-1 w-40 rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-lg tracking-widest dark:border-zinc-700 dark:bg-zinc-900"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          required
        />
      </label>
      <button
        className="mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        disabled={pending || code.length !== 6}
      >
        {strings.devices.claimSubmit}
      </button>
      {message !== null && <Notice tone={message.tone}>{message.text}</Notice>}
    </form>
  );
}
