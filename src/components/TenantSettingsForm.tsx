"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantSettingsStrings } from "@/lib/i18n/admin-strings";
import type { TenantBranding } from "@/lib/tenancy/branding";

/**
 * The tenant admin's presentation and retention form. Quotas and domains are
 * displayed beside it, read-only: the platform operator owns those.
 */
export function TenantSettingsForm({
  initialLocale,
  initialRetentionDays,
  initialBranding,
  labels,
}: {
  initialLocale: "vi" | "en";
  initialRetentionDays: number | null;
  initialBranding: TenantBranding;
  labels: TenantSettingsStrings;
}) {
  const router = useRouter();
  const [locale, setLocale] = useState<"vi" | "en">(initialLocale);
  const [retention, setRetention] = useState(
    initialRetentionDays === null ? "" : String(initialRetentionDays)
  );
  const [logoUrl, setLogoUrl] = useState(initialBranding.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(initialBranding.primaryColor);
  const [accentColor, setAccentColor] = useState(initialBranding.accentColor);
  const [supportEmail, setSupportEmail] = useState(initialBranding.supportEmail ?? "");
  const [supportUrl, setSupportUrl] = useState(initialBranding.supportUrl ?? "");
  const [supportPhone, setSupportPhone] = useState(initialBranding.supportPhone ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    setError("");

    const response = await fetch("/api/admin/settings", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        locale,
        retentionDays: retention.trim() === "" ? null : Number(retention),
        branding: {
          logoUrl: logoUrl.trim() === "" ? null : logoUrl.trim(),
          primaryColor,
          accentColor,
          supportEmail: supportEmail.trim() === "" ? null : supportEmail.trim(),
          supportUrl: supportUrl.trim() === "" ? null : supportUrl.trim(),
          supportPhone: supportPhone.trim() === "" ? null : supportPhone.trim(),
        },
      }),
    });
    setPending(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { errors?: unknown };
      setError(
        Array.isArray(body.errors) && body.errors.every((entry) => typeof entry === "string")
          ? body.errors.join("; ")
          : labels.failed
      );
      return;
    }

    setMessage(labels.saved);
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-6">
      <section>
        <h2 className="font-medium">{labels.brandingHeading}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.brandingHelp}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={labels.logoUrl} value={logoUrl} onChange={setLogoUrl} />
          <Field label={labels.primaryColor} value={primaryColor} onChange={setPrimaryColor} />
          <Field label={labels.accentColor} value={accentColor} onChange={setAccentColor} />
          <Field label={labels.supportEmail} value={supportEmail} onChange={setSupportEmail} />
          <Field label={labels.supportUrl} value={supportUrl} onChange={setSupportUrl} />
          <Field label={labels.supportPhone} value={supportPhone} onChange={setSupportPhone} />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{labels.locale}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value === "en" ? "en" : "vi")}
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 [color-scheme:light] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:[color-scheme:dark]"
          >
            <option value="vi">{labels.localeVi}</option>
            <option value="en">{labels.localeEn}</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{labels.retentionDays}</span>
          <input
            type="number"
            min="1"
            step="1"
            value={retention}
            onChange={(event) => setRetention(event.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 [color-scheme:light] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:[color-scheme:dark]"
          />
          <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
            {labels.retentionHelp}
          </span>
        </label>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? labels.saving : labels.save}
        </button>
        {message !== "" && <span className="text-sm text-emerald-700 dark:text-emerald-300">{message}</span>}
        {error !== "" && (
          <span role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-zinc-900 [color-scheme:light] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:[color-scheme:dark]"
      />
    </label>
  );
}
