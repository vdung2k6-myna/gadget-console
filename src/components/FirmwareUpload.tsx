"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The upload form. The route owns the validation and returns the reasons; this only
 * shows the first one and refreshes the list when the release is stored.
 */
export function FirmwareUpload({
  locale,
  disabledReason,
}: {
  locale: Locale;
  disabledReason: string | null;
}) {
  const strings = adminStringsFor(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (disabledReason !== null) {
    return (
      <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        {disabledReason}
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError("");

    const response = await fetch("/api/admin/firmware", {
      method: "POST",
      credentials: "same-origin",
      body: new FormData(form),
    });
    setPending(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { errors?: unknown; error?: unknown };
      const first = Array.isArray(body.errors) ? body.errors[0] : undefined;
      setError(typeof first === "string" ? first : strings.uploadFailed);
      return;
    }
    form.reset();
    router.refresh();
  }

  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
      onSubmit={submit}
    >
      <label className="flex flex-col gap-1 text-sm">
        {strings.boardType}
        <input
          name="boardType"
          required
          placeholder="esp-box-3"
          className="rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {strings.version}
        <input
          name="version"
          required
          placeholder="1.2.4"
          className="rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {strings.firmwareUpload}
        <input
          name="file"
          type="file"
          required
          accept=".bin,application/octet-stream"
          className="text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {strings.firmwareUpload}
      </button>
      {error !== "" && (
        <span role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </span>
      )}
    </form>
  );
}
