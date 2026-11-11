"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlatformStrings } from "@/lib/i18n/admin-strings";

/**
 * Creating a tenant from the platform area.
 *
 * The route validates the draft; the form only carries the three fields the
 * platform admin needs before domains and settings exist. A duplicate slug is
 * the one refusal worth its own sentence.
 */
export function TenantCreateForm({ labels }: { labels: PlatformStrings }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [locale, setLocale] = useState<"vi" | "en">("vi");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");

    const response = await fetch("/api/admin/tenants", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, slug, locale }),
    });
    setPending(false);

    if (response.status === 409) {
      setError(labels.createTaken);
      return;
    }
    if (!response.ok) {
      setError(labels.createFailed);
      return;
    }

    setName("");
    setSlug("");
    setLocale("vi");
    router.refresh();
  }

  return (
    <section className="mt-6 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">{labels.createHeading}</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.createHelp}</p>
      <form onSubmit={(event) => void submit(event)} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{labels.nameLabel}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className="mt-1 w-full rounded border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
          />
        </label>
        <label className="text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{labels.slugLabel}</span>
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            required
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            className="mt-1 w-full rounded border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
          />
        </label>
        <label className="text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{labels.localeLabel}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value === "en" ? "en" : "vi")}
            className="mt-1 w-full rounded border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
          >
            <option value="vi">{labels.localeVietnamese}</option>
            <option value="en">{labels.localeEnglish}</option>
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? labels.creating : labels.create}
          </button>
        </div>
      </form>
      {error !== "" && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
