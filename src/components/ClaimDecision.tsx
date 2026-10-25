"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import type { Locale } from "@/lib/i18n/locales";

/**
 * Approving or refusing a request. Approval is what hands the device over, so it
 * is one click and a line in the log; a refusal leaves the gadget claimable by
 * somebody else, which is why it asks first.
 */
export function ClaimDecision({ claimId, locale }: { claimId: string; locale: Locale }) {
  const strings = adminStringsFor(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function decide(decision: "approve" | "reject") {
    if (decision === "reject" && !window.confirm(strings.claimRejectConfirm)) return;

    setPending(true);
    setError("");
    const response = await fetch(`/api/admin/claims/${claimId}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setPending(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      setError(
        body.error === "expired" ? strings.claimExpired : body.error === "taken" ? strings.claimTaken : strings.claimFailed
      );
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex flex-col gap-1 text-xs">
      <span className="flex gap-3">
        <button className="underline disabled:opacity-50" disabled={pending} onClick={() => decide("approve")}>
          {strings.claimApprove}
        </button>
        <button className="text-red-700 underline disabled:opacity-50 dark:text-red-300" disabled={pending} onClick={() => decide("reject")}>
          {strings.claimReject}
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
