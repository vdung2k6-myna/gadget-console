"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendJson } from "@/lib/ui/client";
import { useStrings } from "./LocaleProvider";

/**
 * Deleting a provider profile, confirmed in place.
 *
 * The first click asks; the second deletes. A built-in profile has no delete at
 * all: it is the deployment's, not this account's.
 */
export function DeleteProviderProfileButton({ id }: { id: string }) {
  const strings = useStrings();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    setError("");
    const answer = await sendJson(`/api/provider-profiles/${id}`, undefined, "DELETE");
    setPending(false);
    if (answer.ok) {
      router.refresh();
      return;
    }
    setConfirming(false);
    setError(answer.message || strings.common.unexpected);
  }

  if (error !== "") {
    return (
      <span role="alert" className="text-xs text-red-700 dark:text-red-300">
        {error}
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        className="text-xs text-red-700 hover:underline dark:text-red-300"
        onClick={() => setConfirming(true)}
      >
        {strings.providerProfiles.deleteModel}
      </button>
    );
  }

  return (
    <span className="flex items-center gap-3 text-xs">
      <button
        className="text-red-700 hover:underline disabled:opacity-50 dark:text-red-300"
        disabled={pending}
        onClick={remove}
      >
        {strings.providerProfiles.deleteModelShort}
      </button>
      <button
        className="text-zinc-600 hover:underline dark:text-zinc-400"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        {strings.common.cancel}
      </button>
    </span>
  );
}
