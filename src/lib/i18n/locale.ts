import { cookies } from "next/headers";
import { currentTenant } from "@/lib/tenancy/context";
import { en } from "./dictionaries/en";
import { vi, type Strings } from "./dictionaries/vi";
import { LOCALES, effectiveLocale, localeFrom, type Locale } from "./locales";

/**
 * The words for the language this browser chose, or its tenant's default.
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

/**
 * The locale as the server sees it: the cookie when the person chose one, else
 * the resolved tenant's locale, else Vietnamese.
 */
export async function readLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  const resolved = await currentTenant();
  const tenantDefault =
    resolved.kind === "tenant" ? resolved.tenant.locale : undefined;
  return effectiveLocale(chosen, tenantDefault);
}

export async function getStrings(): Promise<{ locale: Locale; strings: Strings }> {
  const locale = await readLocale();
  return { locale, strings: stringsFor(locale) };
}

export { LOCALES, localeFrom, type Locale };
