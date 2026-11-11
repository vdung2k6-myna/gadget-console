"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SupportAccessStrings } from "@/lib/i18n/admin-strings";

/**
 * The button that takes the support action. It does not show the conversation
 * itself; it records the access and returns to the page with the grant id.
 */
export function SupportAccessForm({
  deviceId,
  labels,
}: {
  deviceId: string;
  labels: SupportAccessStrings;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function open(): Promise<void> {
    setPending(true);
    setError("");
    const response = await fetch("/api/admin/support/access", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId }),
    });
    setPending(false);

    if (!response.ok) {
      setError(labels.failed);
      return;
    }
    const body = (await response.json()) as { access?: { id?: unknown } };
    const id = body.access?.id;
    if (typeof id !== "string") {
      setError(labels.failed);
      return;
    }
    router.push(`/admin/support/${encodeURIComponent(deviceId)}?access=${encodeURIComponent(id)}`);
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => void open()}
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? labels.opening : labels.open}
      </button>
      {error !== "" && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
