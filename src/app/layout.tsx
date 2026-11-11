import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LocaleProvider } from "@/components/LocaleProvider";
import { SignOutButton } from "@/components/SignOutButton";
import { TenantBrandMark, TenantSupportFooter } from "@/components/TenantBranding";
import { optionalUser } from "@/lib/auth/require-user";
import { isAdminRole, isPlatformAdmin } from "@/lib/auth/roles";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { tenantBranding } from "@/lib/tenancy/branding";
import { currentTenant } from "@/lib/tenancy/context";
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
  const isAdmin =
    user !== undefined && (isAdminRole(user.role) || user.role === "admin");
  const platformAdmin = user !== undefined && isPlatformAdmin(user.role);
  const adminStrings = isAdmin ? adminStringsFor(locale) : null;

  const resolved = await currentTenant();
  const tenant = resolved.kind === "tenant" ? resolved.tenant : undefined;
  const branding = tenant === undefined ? undefined : tenantBranding(tenant.branding);
  const brandName = tenant?.name ?? strings.appName;

  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <LocaleProvider strings={strings}>
          <header
            className="border-b border-zinc-200 dark:border-zinc-800"
            style={
              branding === undefined ? undefined : { borderBottomColor: branding.primaryColor }
            }
          >
            <nav className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <TenantBrandMark branding={branding} fallbackName={brandName} />
              {user !== undefined && (
                <>
                  <Link href="/devices" className="hover:underline">
                    {strings.nav.home}
                  </Link>
                  <Link href="/agents" className="hover:underline">
                    {strings.nav.personalities}
                  </Link>
                </>
              )}
              {adminStrings !== null && (
                <>
                  <Link
                    href={platformAdmin ? "/admin/platform" : "/admin/devices"}
                    className="hover:underline"
                  >
                    {platformAdmin ? adminStrings.platform.nav : adminStrings.nav}
                  </Link>
                  {!platformAdmin && (
                    <Link href="/provider-profiles" className="hover:underline">
                      {strings.nav.providers}
                    </Link>
                  )}
                </>
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
          <TenantSupportFooter branding={branding} label={strings.support.label} />
        </LocaleProvider>
      </body>
    </html>
  );
}
