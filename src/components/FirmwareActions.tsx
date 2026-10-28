"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import type { Locale } from "@/lib/i18n/locales";

/**
 * One release's controls: make it the target (optionally forced), clear the target,
 * or delete it. A forced target is confirmed first — it is the act that allows a
 * downgrade — and a targeted release is refused by the route, whose 409 this turns
 * into a sentence.
 */
export function FirmwareActions({
  id,
  targeted,
  forced,
  locale,
}: {
  id: string;
  targeted: boolean;
  forced: boolean;
  locale: Locale;
}) {
  const strings = adminStringsFor(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [force, setForce] = useState(forced);

  async function send(method: "POST" | "DELETE", path = "", body?: unknown) {
    setPending(true);
    setError("");
    const response = await fetch(`/api/admin/firmware/${id}${path}`, {
      method,
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    setPending(false);
    if (response.status === 409) {
      setError(strings.deleteTargeted);
      return false;
    }
    if (!response.ok) {
      setError(strings.uploadFailed);
      return false;
    }
    router.refresh();
    return true;
  }

  async function target() {
    if (force && !window.confirm(strings.forcedConfirm)) return;
    await send("POST", "/target", { forced: force });
  }

  return (
    <span className="flex flex-col gap-1 text-xs">
      {!targeted && (
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
          {strings.forced}
        </label>
      )}
      <span className="flex flex-wrap gap-3">
        <button
          className="underline disabled:opacity-50"
          disabled={pending}
          onClick={() => target()}
        >
          {strings.target}
        </button>
        {targeted && (
          <button
            className="underline disabled:opacity-50"
            disabled={pending}
            onClick={() => send("DELETE", "/target")}
          >
            {strings.untarget}
          </button>
        )}
        <button
          className="text-red-700 underline disabled:opacity-50 dark:text-red-300"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(strings.deleteConfirm)) return;
            void send("DELETE");
          }}
        >
          {strings.delete}
        </button>
      </span>
      {error !== "" && (
        <span role="alert" className="text-red-700 dark:text-red-300">
          {error}
        </span>
      )}
    </span>
  );
}
