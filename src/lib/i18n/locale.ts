import { cookies } from "next/headers";
import { en } from "./dictionaries/en";
import { vi, type Strings } from "./dictionaries/vi";
import { LOCALES, localeFrom, type Locale } from "./locales";

/**
 * The words for the language this browser chose.
 *
 * A cookie rather than a URL segment: these pages are behind a session and are
 * neither shared nor indexed, so a `/[locale]` segment would touch every route,
 * every link and the session redirect for nothing.
 */

export const LOCALE_COOKIE = "gc_locale";

const DICTIONARIES: Record<Locale, Strings> = { vi, en };

export function stringsFor(locale: Locale): Strings {
  return DICTIONARIES[locale];
}

/** The locale as the server sees it: the cookie, or Vietnamese when absent or odd. */
export async function readLocale(): Promise<Locale> {
  return localeFrom((await cookies()).get(LOCALE_COOKIE)?.value);
}

export async function getStrings(): Promise<{ locale: Locale; strings: Strings }> {
  const locale = await readLocale();
  return { locale, strings: stringsFor(locale) };
}

export { LOCALES, localeFrom, type Locale };
