"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/ui/client";
import type { AdminStrings } from "@/lib/i18n/admin-strings";

const field =
  "mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** The tenant's routing policy: local-only, fallback order and a stated budget. */
export function AdapterPolicyForm({
  localOnly,
  order,
  monthlyBudgetUsd,
  labels,
}: {
  localOnly: boolean;
  order: string[];
  monthlyBudgetUsd: number | null;
  labels: AdminStrings["adapters"];
}) {
  const router = useRouter();
  const [onlyLocal, setOnlyLocal] = useState(localOnly);
  const [orderText, setOrderText] = useState(order.join(", "));
  const [budget, setBudget] = useState(
    monthlyBudgetUsd === null ? "" : String(monthlyBudgetUsd)
  );
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const answer = await sendJson("/api/admin/adapters/policy", {
      localOnly: onlyLocal,
      order: orderText
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ""),
      monthlyBudgetUsd: budget === "" ? null : Number(budget),
    }, "PATCH");
    setPending(false);
    setMessage(answer.ok ? labels.saved : `${labels.policyFailed} ${answer.message}`.trim());
    if (answer.ok) router.refresh();
  }

  return (
    <form onSubmit={save} className="mt-4 max-w-2xl">
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={onlyLocal}
          onChange={(event) => setOnlyLocal(event.target.checked)}
        />
        {labels.localOnly}
      </label>
      <label className="mt-3 block text-sm">
        {labels.order}
        <input
          className={field}
          value={orderText}
          onChange={(event) => setOrderText(event.target.value)}
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{labels.orderHint}</span>
      </label>
      <label className="mt-3 block text-sm">
        {labels.budget}
        <input
          className={field}
          type="number"
          min={0}
          step={1}
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
        />
      </label>
      <button
        className="mt-3 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        disabled={pending}
      >
        {labels.save}
      </button>
      {message !== "" && <p className="mt-1 text-sm">{message}</p>}
    </form>
  );
}
