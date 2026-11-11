"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/ui/client";
import type { AdminStrings } from "@/lib/i18n/admin-strings";

/** Rotate or disable one adapter. Rotating shows the new token once. */
export function AdapterActions({
  id,
  labels,
}: {
  id: string;
  labels: AdminStrings["adapters"];
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function rotate() {
    setPending(true);
    setMessage("");
    const answer = await sendJson(`/api/admin/adapters/${id}/rotate`, {});
    setPending(false);
    if (!answer.ok) {
      setMessage(answer.message);
      return;
    }
    const data = answer.data as { token?: unknown } | undefined;
    setToken(typeof data?.token === "string" ? data.token : "");
    router.refresh();
  }

  async function disable() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setPending(true);
    const answer = await sendJson(`/api/admin/adapters/${id}/disable`, {});
    setPending(false);
    setConfirming(false);
    if (!answer.ok) setMessage(answer.message);
    router.refresh();
  }

  return (
    <div className="text-xs">
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700"
          onClick={rotate}
          disabled={pending}
        >
          {labels.rotate}
        </button>
        <button
          type="button"
          className="rounded border border-red-300 px-2 py-1 text-red-700 dark:border-red-800 dark:text-red-300"
          onClick={disable}
          disabled={pending}
        >
          {confirming ? labels.disableConfirm : labels.disable}
        </button>
      </div>
      {token !== "" && (
        <p className="mt-1 break-all font-mono text-[10px]">
          {labels.tokenOnce}: {token}
        </p>
      )}
      {message !== "" && <p className="mt-1 text-red-700 dark:text-red-300">{message}</p>}
    </div>
  );
}
