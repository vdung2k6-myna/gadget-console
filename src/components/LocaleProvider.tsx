"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Strings } from "@/lib/i18n/dictionaries/vi";

/**
 * The active dictionary, handed down from the layout.
 *
 * Server components read it directly; a client form reads it here, so no form
 * has to be passed a dictionary as a prop by the page that renders it.
 */
const LocaleContext = createContext<Strings | null>(null);

export function LocaleProvider({ strings, children }: { strings: Strings; children: ReactNode }) {
  return <LocaleContext.Provider value={strings}>{children}</LocaleContext.Provider>;
}

export function useStrings(): Strings {
  const value = useContext(LocaleContext);
  if (value === null) {
    throw new Error("useStrings() was called outside <LocaleProvider>");
  }
  return value;
}
