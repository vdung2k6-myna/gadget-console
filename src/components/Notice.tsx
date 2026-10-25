import type { ReactNode } from "react";

/**
 * One shape for both outcomes, so a success and a failure can never drift apart
 * in wording or colour across the screens that use them.
 */
export function Notice({
  tone,
  children,
}: {
  tone: "ok" | "error";
  children: ReactNode;
}) {
  const classes =
    tone === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
      : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100";

  return (
    <p role={tone === "error" ? "alert" : "status"} className={`mt-3 rounded border px-3 py-2 text-sm ${classes}`}>
      {children}
    </p>
  );
}
