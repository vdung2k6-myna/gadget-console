"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import type { Locale } from "@/lib/i18n/locales";

/**
 * Granting or taking away the admin role, from the account list.
 *
 * The route refuses a change that would leave no admin; the page turns that
 * refusal into a sentence, because the words belong to the interface. Demoting
 * asks first — it takes the area away from somebody else.
 */
export function RoleControl({
  userId,
  email,
  role,
  locale,
}: {
  userId: string;
  email: string;
  role: "user" | "admin";
  locale: Locale;
}) {
  const strings = adminStringsFor(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const next = role === "admin" ? "user" : "admin";

  async function change() {
    if (next === "user" && !window.confirm(strings.demoteConfirm.replace("{email}", email))) return;

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
      setError(body.error === "protected" ? strings.protectedAccount : strings.lastAdmin);
      return;
    }
    if (!response.ok) {
      setError(strings.roleFailed);
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex flex-col gap-1">
      <button
        className="text-xs underline disabled:opacity-50"
        disabled={pending}
        onClick={change}
      >
        {next === "admin" ? strings.promote : strings.demote}
      </button>
      {error !== "" && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </span>
      )}
    </span>
  );
}
