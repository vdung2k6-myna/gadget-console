"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import type { Locale } from "@/lib/i18n/locales";
import type { UserRole } from "@/lib/auth/roles";

const ROLE_ORDER: UserRole[] = ["user", "support", "tenant_admin", "platform_admin"];

/**
 * Changing a role from the account list.
 *
 * A platform admin may grant any role; a tenant admin may grant only the
 * tenant-scoped ones. The route refuses the last-admin, protected and
 * platform-admin-without-a-tenant cases; the page turns each into a sentence.
 */
export function RoleControl({
  userId,
  email,
  role,
  actorRole,
  locale,
}: {
  userId: string;
  email: string;
  role: UserRole;
  actorRole: string;
  locale: Locale;
}) {
  const strings = adminStringsFor(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<UserRole>(role);
  const [error, setError] = useState("");

  const allowed = ROLE_ORDER.filter(
    (entry) =>
      entry !== "platform_admin" || actorRole === "platform_admin" || actorRole === "admin"
  );

  function label(entry: UserRole): string {
    if (entry === "platform_admin") return strings.rolePlatformAdmin;
    if (entry === "tenant_admin") return strings.roleTenantAdmin;
    if (entry === "support") return strings.roleSupport;
    return strings.roleUser;
  }

  async function change(next: UserRole): Promise<void> {
    if (next === role) return;
    if (next === "user" && !window.confirm(strings.demoteConfirm.replace("{email}", email))) {
      setSelected(role);
      return;
    }

    setPending(true);
    setError("");
    const response = await fetch(`/api/admin/users/${userId}/role`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: next }),
    });
    setPending(false);

    if (response.status === 409) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      setError(
        body.error === "protected"
          ? strings.protectedAccount
          : body.error === "no-tenant"
            ? strings.noTenant
            : strings.lastAdmin
      );
      setSelected(role);
      return;
    }
    if (!response.ok) {
      setError(strings.roleFailed);
      setSelected(role);
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex flex-col gap-1">
      {/* `color-scheme` makes the native option list match the page instead of
          inheriting the OS theme; a transparent control left its options
          unreadable in dark mode. */}
      <select
        aria-label={strings.role}
        className="w-full max-w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 shadow-sm [color-scheme:light] focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:[color-scheme:dark] dark:focus:ring-zinc-600"
        value={selected}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value as UserRole;
          setSelected(next);
          void change(next);
        }}
      >
        {allowed.map((entry) => (
          <option key={entry} value={entry}>
            {label(entry)}
          </option>
        ))}
      </select>
      {error !== "" && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </span>
      )}
    </span>
  );
}
