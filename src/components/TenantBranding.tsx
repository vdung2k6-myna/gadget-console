import type { TenantBranding } from "@/lib/tenancy/branding";

/**
 * The tenant's mark in the header. No branding (the platform host) keeps the
 * console's own name and colours; a tenant's logo replaces the name, and its
 * primary colour replaces the header rule.
 */
export function TenantBrandMark({
  branding,
  fallbackName,
}: {
  branding: TenantBranding | undefined;
  fallbackName: string;
}) {
  if (branding === undefined) {
    return <span className="font-semibold">{fallbackName}</span>;
  }

  if (branding.logoUrl !== null) {
    return (
      <img
        src={branding.logoUrl}
        alt={fallbackName}
        className="h-6 w-auto"
      />
    );
  }

  return (
    <span className="font-semibold" style={{ color: branding.primaryColor }}>
      {fallbackName}
    </span>
  );
}

/** The tenant's support contacts, if it states any. */
export function TenantSupportFooter({
  branding,
  label,
}: {
  branding: TenantBranding | undefined;
  label: string;
}) {
  if (branding === undefined) return null;

  const contacts = [
    branding.supportEmail === null ? null : (
      <a
        key="email"
        href={`mailto:${branding.supportEmail}`}
        className="hover:underline"
        style={{ color: branding.accentColor }}
      >
        {branding.supportEmail}
      </a>
    ),
    branding.supportPhone === null ? null : (
      <a
        key="phone"
        href={`tel:${branding.supportPhone.replace(/[^+0-9]/g, "")}`}
        className="hover:underline"
        style={{ color: branding.accentColor }}
      >
        {branding.supportPhone}
      </a>
    ),
    branding.supportUrl === null ? null : (
      <a
        key="url"
        href={branding.supportUrl}
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
        style={{ color: branding.accentColor }}
      >
        {new URL(branding.supportUrl).hostname}
      </a>
    ),
  ].filter((contact) => contact !== null);

  if (contacts.length === 0) return null;

  return (
    <footer
      className="border-t border-zinc-200 dark:border-zinc-800"
      style={{ borderTopColor: branding.primaryColor }}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        {contacts}
      </div>
    </footer>
  );
}
