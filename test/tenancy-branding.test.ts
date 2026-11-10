import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { closeDb, requireTestDatabase, resetDb } from "./helpers/db";
import {
  DEFAULT_BRANDING,
  tenantBranding,
  validateBranding,
} from "../src/lib/tenancy/branding";
import { effectiveLocale } from "../src/lib/i18n/locales";
import {
  TenantBrandMark,
  TenantSupportFooter,
} from "../src/components/TenantBranding";
import { createTenant, findTenant, validateTenantDraft } from "../src/lib/tenants";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

describe("tenant branding validation", () => {
  it("normalizes a complete branding draft", () => {
    const result = validateBranding({
      logoUrl: "https://cdn.example/logo.svg",
      primaryColor: "#ABC",
      accentColor: "#123456",
      supportEmail: "help@acme.example",
      supportUrl: "https://acme.example/help",
      supportPhone: "+84 912 345 678",
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.branding, {
      logoUrl: "https://cdn.example/logo.svg",
      primaryColor: "#abc",
      accentColor: "#123456",
      supportEmail: "help@acme.example",
      supportUrl: "https://acme.example/help",
      supportPhone: "+84 912 345 678",
    });
  });

  it("accepts a same-origin logo and no branding at all", () => {
    const relative = validateBranding({ logoUrl: "/brand/logo.png" });
    assert.equal(relative.ok, true);
    if (relative.ok) assert.equal(relative.branding?.logoUrl, "/brand/logo.png");

    assert.deepEqual(validateBranding(null), { ok: true, branding: null });
  });

  it("refuses unsafe URLs, bad colours, bad contacts and unknown fields", () => {
    for (const branding of [
      { logoUrl: "javascript:alert(1)" },
      { logoUrl: "//evil.example/logo.png" },
      { primaryColor: "red" },
      { accentColor: "#12345" },
      { supportEmail: "not-an-email" },
      { supportUrl: "mailto:help@acme.example" },
      { supportPhone: "call me" },
      { tagline: "hi" },
      [],
    ]) {
      assert.equal(validateBranding(branding).ok, false, JSON.stringify(branding));
    }
  });

  it("sanitizes stored branding when it is read for rendering", () => {
    const branding = tenantBranding({
      logoUrl: "javascript:alert(1)",
      primaryColor: "red",
      accentColor: "#00ff00",
      supportEmail: "bad",
      supportUrl: "https://acme.example/help",
      supportPhone: "+84912",
    });

    assert.equal(branding.logoUrl, null);
    assert.equal(branding.primaryColor, DEFAULT_BRANDING.primaryColor);
    assert.equal(branding.accentColor, "#00ff00");
    assert.equal(branding.supportEmail, null);
    assert.equal(branding.supportUrl, "https://acme.example/help");
    assert.equal(branding.supportPhone, "+84912");
    assert.deepEqual(tenantBranding(null), DEFAULT_BRANDING);
  });
});

describe("tenant locale", () => {
  it("uses the cookie when chosen and the tenant default otherwise", () => {
    assert.equal(effectiveLocale(undefined, "en"), "en");
    assert.equal(effectiveLocale("vi", "en"), "vi");
    assert.equal(effectiveLocale("fr", "vi"), "vi");
    assert.equal(effectiveLocale(undefined, undefined), "vi");
  });
});

describe("branding rendering", () => {
  const branding = tenantBranding({
    logoUrl: "https://cdn.example/logo.svg",
    primaryColor: "#112233",
    accentColor: "#445566",
    supportEmail: "help@acme.example",
    supportPhone: "+84 912 345 678",
    supportUrl: "https://acme.example/help",
  });

  it("renders the logo or the primary-coloured name", () => {
    const logo = renderToStaticMarkup(
      createElement(TenantBrandMark, { branding, fallbackName: "Acme" })
    );
    assert.match(logo, /src="https:\/\/cdn\.example\/logo\.svg"/);
    assert.match(logo, /alt="Acme"/);

    const named = renderToStaticMarkup(
      createElement(TenantBrandMark, {
        branding: tenantBranding({ primaryColor: "#112233" }),
        fallbackName: "Acme",
      })
    );
    assert.match(named, /style="color:#112233"/);
    assert.match(named, />Acme</);
  });

  it("renders the support contacts the tenant states", () => {
    const footer = renderToStaticMarkup(
      createElement(TenantSupportFooter, { branding, label: "Support" })
    );

    assert.match(footer, /Support/);
    assert.match(footer, /mailto:help@acme\.example/);
    assert.match(footer, /tel:\+84912345678/);
    assert.match(footer, /https:\/\/acme\.example\/help/);
    assert.match(footer, /style="color:#445566"/);
  });

  it("renders no support footer for the platform", () => {
    const footer = renderToStaticMarkup(
      createElement(TenantSupportFooter, { branding: undefined, label: "Support" })
    );
    assert.equal(footer, "");
  });
});

describe("branding storage", () => {
  it("validates a tenant draft and stores the branding", async () => {
    const validation = validateTenantDraft({
      name: "Acme",
      slug: "acme",
      branding: {
        primaryColor: "#112233",
        supportEmail: "help@acme.example",
      },
    });
    assert.equal(validation.ok, true);
    if (!validation.ok) return;

    const created = await createTenant(validation.draft);
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const stored = await findTenant(created.tenant.id);
    const branding = tenantBranding(stored?.branding);
    assert.equal(branding.primaryColor, "#112233");
    assert.equal(branding.accentColor, DEFAULT_BRANDING.accentColor);
    assert.equal(branding.supportEmail, "help@acme.example");
  });

  it("refuses a tenant draft with bad branding", () => {
    const validation = validateTenantDraft({
      name: "Acme",
      slug: "acme",
      branding: { primaryColor: "not-a-colour" },
    });
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.match(validation.errors.join("; "), /primaryColor/);
    }
  });
});
