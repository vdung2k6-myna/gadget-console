/**
 * A tenant's white-label presentation.
 *
 * Branding is stored on the tenant as JSON, but nothing in the database is
 * trusted at render time: `tenantBranding` reads only the fields it knows and
 * drops anything that is not a safe URL, a hex colour or a plausible contact.
 * Platform admins write it through the validated draft in `tenants.ts`.
 *
 * Locale lives beside branding on the tenant row rather than in this object, so
 * a language change does not rewrite the logo and colours.
 */

export interface TenantBranding {
  /** An absolute http(s) URL or a same-origin path beginning with `/`. */
  logoUrl: string | null;
  /** Hex colour used for the brand mark and the header rule. */
  primaryColor: string;
  /** Hex colour used for support links. */
  accentColor: string;
  supportEmail: string | null;
  supportUrl: string | null;
  supportPhone: string | null;
}

export const DEFAULT_BRANDING: TenantBranding = {
  logoUrl: null,
  primaryColor: "#2563eb",
  accentColor: "#7c3aed",
  supportEmail: null,
  supportUrl: null,
  supportPhone: null,
};

export type BrandingValidation =
  | { ok: true; branding: TenantBranding | null }
  | { ok: false; errors: string[] };

const FIELDS = new Set([
  "logoUrl",
  "primaryColor",
  "accentColor",
  "supportEmail",
  "supportUrl",
  "supportPhone",
]);
const HEX = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+0-9().\-\s]{3,32}$/;
const ASSET_PATH = /^\/(?!\/)[^\s]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function present(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** An http(s) URL without credentials, or a same-origin path. */
function assetUrl(value: string): string | undefined {
  if (ASSET_PATH.test(value)) return value;

  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "") {
      return url.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function absoluteHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === ""
    ) {
      return url.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function hex(value: string): string | undefined {
  return HEX.test(value) ? value.toLowerCase() : undefined;
}

/**
 * Validate a draft's branding. Unknown keys are refused so a typo in an
 * operator's JSON does not disappear silently; absent branding is allowed.
 */
export function validateBranding(input: unknown): BrandingValidation {
  if (input === undefined || input === null) return { ok: true, branding: null };
  if (!isRecord(input)) return { ok: false, errors: ["branding must be an object"] };

  const errors: string[] = [];
  for (const key of Object.keys(input)) {
    if (!FIELDS.has(key)) errors.push(`unknown branding field ${JSON.stringify(key)}`);
  }

  const logoUrl = present(input.logoUrl);
  if (logoUrl !== undefined && assetUrl(logoUrl) === undefined) {
    errors.push("logoUrl must be an http(s) URL or a path beginning with /");
  }

  const primaryColor = present(input.primaryColor);
  if (primaryColor !== undefined && hex(primaryColor) === undefined) {
    errors.push("primaryColor must be a hex colour");
  }

  const accentColor = present(input.accentColor);
  if (accentColor !== undefined && hex(accentColor) === undefined) {
    errors.push("accentColor must be a hex colour");
  }

  const supportEmail = present(input.supportEmail);
  if (supportEmail !== undefined && !EMAIL.test(supportEmail)) {
    errors.push("supportEmail must be an email address");
  }

  const supportUrl = present(input.supportUrl);
  if (supportUrl !== undefined && absoluteHttpUrl(supportUrl) === undefined) {
    errors.push("supportUrl must be an http(s) URL");
  }

  const supportPhone = present(input.supportPhone);
  if (supportPhone !== undefined && !PHONE.test(supportPhone)) {
    errors.push("supportPhone must be a phone number");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    branding: {
      logoUrl: logoUrl === undefined ? null : assetUrl(logoUrl)!,
      primaryColor: primaryColor === undefined ? DEFAULT_BRANDING.primaryColor : hex(primaryColor)!,
      accentColor: accentColor === undefined ? DEFAULT_BRANDING.accentColor : hex(accentColor)!,
      supportEmail: supportEmail ?? null,
      supportUrl: supportUrl === undefined ? null : absoluteHttpUrl(supportUrl)!,
      supportPhone: supportPhone ?? null,
    },
  };
}

/**
 * Read branding for rendering. An invalid field falls back to its default rather
 * than breaking the page; a row written before validation existed still renders.
 */
export function tenantBranding(input: unknown): TenantBranding {
  if (!isRecord(input)) return { ...DEFAULT_BRANDING };

  const logoUrl = present(input.logoUrl);
  const primaryColor = present(input.primaryColor);
  const accentColor = present(input.accentColor);
  const supportEmail = present(input.supportEmail);
  const supportUrl = present(input.supportUrl);
  const supportPhone = present(input.supportPhone);

  const safeLogo = logoUrl === undefined ? undefined : assetUrl(logoUrl);
  const safePrimary = primaryColor === undefined ? undefined : hex(primaryColor);
  const safeAccent = accentColor === undefined ? undefined : hex(accentColor);
  const safeUrl = supportUrl === undefined ? undefined : absoluteHttpUrl(supportUrl);

  return {
    logoUrl: safeLogo ?? null,
    primaryColor: safePrimary ?? DEFAULT_BRANDING.primaryColor,
    accentColor: safeAccent ?? DEFAULT_BRANDING.accentColor,
    supportEmail: supportEmail !== undefined && EMAIL.test(supportEmail) ? supportEmail : null,
    supportUrl: safeUrl ?? null,
    supportPhone: supportPhone !== undefined && PHONE.test(supportPhone) ? supportPhone : null,
  };
}
