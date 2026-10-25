"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { useStrings } from "./LocaleProvider";

/**
 * The language choice. It posts the cookie and refreshes, so the server renders
 * the whole page in the chosen language — one source of truth, no client-side
 * dictionary swap.
 */
export function LanguageSwitcher({ current }: { current: Locale }) {
  const strings = useStrings();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function choose(locale: Locale) {
    if (locale === current || pending) return;
    setPending(true);
    await fetch("/api/locale", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    router.refresh();
    setPending(false);
  }

  return (
    <span className="flex items-center gap-2 text-xs" aria-label={strings.locale.label}>
      {LOCALES.map((locale) => (
        <button
          key={locale}
          onClick={() => choose(locale)}
          disabled={pending}
          aria-current={locale === current ? "true" : undefined}
          className={
            locale === current
              ? "font-semibold"
              : "text-zinc-500 hover:underline dark:text-zinc-400"
          }
        >
          {strings.locale[locale]}
        </button>
      ))}
    </span>
  );
}
