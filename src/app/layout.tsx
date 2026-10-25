import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LocaleProvider } from "@/components/LocaleProvider";
import { SignOutButton } from "@/components/SignOutButton";
import { optionalUser } from "@/lib/auth/require-user";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { strings } = await getStrings();
  return { title: strings.appName, description: strings.signIn.subtitle };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The dictionary and the session are both per request: the words depend on a
  // cookie, and the signed-in half of the header exists only when somebody is.
  const { locale, strings } = await getStrings();
  const user = await optionalUser();
  // The admin area's own words, read only for an account that may open it.
  const adminStrings = user?.role === "admin" ? adminStringsFor(locale) : null;

  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <LocaleProvider strings={strings}>
          <header className="border-b border-zinc-200 dark:border-zinc-800">
            <nav className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="font-semibold">{strings.appName}</span>
              {user !== undefined && (
                <>
                  <Link href="/devices" className="hover:underline">
                    {strings.nav.devices}
                  </Link>
                  <Link href="/agents" className="hover:underline">
                    {strings.nav.agents}
                  </Link>
                  <Link href="/llm-profiles" className="hover:underline">
                    {strings.nav.llmProfiles}
                  </Link>
                </>
              )}
              {adminStrings !== null && (
                <Link href="/admin/devices" className="hover:underline">
                  {adminStrings.nav}
                </Link>
              )}
              <Link href="/help" className="hover:underline">
                {strings.nav.help}
              </Link>
              <span className="ml-auto flex items-center gap-3">
                <LanguageSwitcher current={locale} />
                {user !== undefined && (
                  <>
                    {/* An address is not worth a line of its own on a phone. */}
                    <span className="hidden text-zinc-500 sm:inline dark:text-zinc-400">{user.email}</span>
                    <SignOutButton />
                  </>
                )}
              </span>
            </nav>
          </header>
          <div className="flex-1">{children}</div>
        </LocaleProvider>
      </body>
    </html>
  );
}
