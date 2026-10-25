import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isLocale } from "@/lib/i18n/locales";
import { LOCALE_COOKIE } from "@/lib/i18n/locale";

/**
 * Remembers the language for this browser. A year, httpOnly, same-site: nothing
 * in the browser needs to read it, because the dictionary reaches the page
 * through the server.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const locale = typeof body === "object" && body !== null ? (body as { locale?: unknown }).locale : undefined;
  if (!isLocale(locale)) {
    return NextResponse.json({ error: "unknown locale" }, { status: 400 });
  }

  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  return new NextResponse(null, { status: 204 });
}
