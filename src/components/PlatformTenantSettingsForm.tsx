"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  PlatformStrings,
  TenantSettingsStrings,
} from "@/lib/i18n/admin-strings";
import type { TenantBranding } from "@/lib/tenancy/branding";

const QUOTA_FIELDS = [
  ["devices", "quotaDevices"],
  ["turns", "quotaTurns"],
  ["concurrency", "quotaConcurrency"],
  ["speechSeconds", "quotaSpeechSeconds"],
  ["providerSpend", "quotaProviderSpend"],
] as const;

/** The platform's tenant settings: plan, allowance, retention, locale and quotas. *
 * Branding is sent back unchanged so a quota save cannot erase the tenant's mark.
 */
export function PlatformTenantSettingsForm({
  tenantId,
  initialLocale,
  initialRetentionDays,
  initialPlan,
  initialAllowance,
  initialQuotas,
  branding,
  labels,
  platformLabels,
}: {
  tenantId: string;
  initialLocale: "vi" | "en";
  initialRetentionDays: number | null;
  initialPlan: string | null;
  initialAllowance: number | null;
  initialQuotas: Record<string, number> | null;
  branding: TenantBranding | null;
  labels: TenantSettingsStrings;
  platformLabels: PlatformStrings;
}) {
  const router = useRouter();
  const [locale, setLocale] = useState<"vi" | "en">(initialLocale);
  const [retention, setRetention] = useState(
    initialRetentionDays === null ? "" : String(initialRetentionDays)
  );
  const [plan, setPlan] = useState(initialPlan ?? "");
  const [allowance, setAllowance] = useState(
    initialAllowance === null ? "" : String(initialAllowance)
  );
  const [quotas, setQuotas] = useState<Record<string, string>>(
    Object.fromEntries(
      QUOTA_FIELDS.map(([key]) => [
        key,
        initialQuotas?.[key] === undefined ? "" : String(initialQuotas[key]),
      ])
    )
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage("");
    setError("");

    const quotaValues: Record<string, number> = {};
    for (const [key] of QUOTA_FIELDS) {
      const raw = quotas[key]?.trim() ?? "";
      if (raw !== "") quotaValues[key] = Number(raw);
    }

    const response = await fetch(`/api/admin/tenants/${tenantId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        locale,
        retentionDays: retention.trim() === "" ? null : Number(retention),
        plan: plan.trim() === "" ? null : plan.trim(),
        speechAllowanceSeconds: allowance.trim() === "" ? null : Number(allowance),
        quotas: Object.keys(quotaValues).length === 0 ? null : quotaValues,
        branding,
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
    <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
      <h2 className="font-medium">{platformLabels.usage}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={labels.plan} value={plan} onChange={setPlan} />
        <Field
          label={labels.speechAllowance}
          value={allowance}
          onChange={setAllowance}
          numeric
        />
        <Field label={labels.retentionDays} value={retention} onChange={setRetention} numeric />
        <label className="text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">{labels.locale}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value === "en" ? "en" : "vi")}
            className="mt-1 w-full rounded border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
          >
            <option value="vi">{labels.localeVi}</option>
            <option value="en">{labels.localeEn}</option>
          </select>
        </label>
      </div>

      <h3 className="font-medium">{labels.quotas}</h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{labels.quotasHelp}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {QUOTA_FIELDS.map(([key, labelKey]) => (
          <Field
            key={key}
            label={labels[labelKey]}
            value={quotas[key] ?? ""}
            onChange={(value) => setQuotas((current) => ({ ...current, [key]: value }))}
            numeric
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? labels.saving : labels.save}
        </button>
        {message !== "" && (
          <span className="text-sm text-emerald-700 dark:text-emerald-300">{message}</span>
        )}
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
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <label className="text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <input
        type={numeric ? "number" : "text"}
        min={numeric ? "0" : undefined}
        step={numeric ? "1" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
      />
    </label>
  );
}
