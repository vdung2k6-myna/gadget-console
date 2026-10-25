/**
 * The languages this interface has, and nothing that needs a request.
 *
 * Kept apart from `locale.ts` so a client component can name a locale without
 * pulling in `next/headers`, which a browser bundle cannot use.
 */
export const LOCALES = ["vi", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "vi";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** What a stored value means: the language it names, or the default. */
export function localeFrom(value: string | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
