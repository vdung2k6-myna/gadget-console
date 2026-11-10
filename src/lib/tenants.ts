import { eq, asc } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import { validateBranding, type TenantBranding } from "@/lib/tenancy/branding";

/**
 * The tenant catalog the platform admin manages.
 *
 * A tenant is a reseller's slice of the deployment. Creation is explicit and
 * validated; suspension keeps the data and stops the tenant being served; the
 * lifecycle's export and deletion are a later task.
 */

export type TenantRow = typeof tenants.$inferSelect;
export type TenantStatus = "active" | "suspended";

export interface TenantDraft {
  name: string;
  slug: string;
  locale: "vi" | "en";
  retentionDays: number | null;
  speechAllowanceSeconds: number | null;
  plan: string | null;
  quotas: Record<string, number> | null;
  branding: TenantBranding | null;
}

export type TenantValidation =
  | { ok: true; draft: TenantDraft }
  | { ok: false; errors: string[] };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateTenantDraft(input: unknown): TenantValidation {
  if (!isRecord(input)) return { ok: false, errors: ["the body must be an object"] };

  const errors: string[] = [];
  const name = text(input.name);
  const slug = text(input.slug).toLowerCase();
  if (name === "") errors.push("a name is required");
  if (slug === "" || slug.length > 63 || !SLUG.test(slug)) {
    errors.push("a slug is required: lowercase letters, digits and hyphens");
  }

  const locale = input.locale === undefined ? "vi" : text(input.locale);
  if (locale !== "vi" && locale !== "en") errors.push("locale must be vi or en");

  let retentionDays: number | null = null;
  if (input.retentionDays !== undefined && input.retentionDays !== null && input.retentionDays !== "") {
    const value = Number(input.retentionDays);
    if (!Number.isInteger(value) || value <= 0) {
      errors.push("retentionDays must be a positive integer");
    } else {
      retentionDays = value;
    }
  }

  let speechAllowanceSeconds: number | null = null;
  if (
    input.speechAllowanceSeconds !== undefined &&
    input.speechAllowanceSeconds !== null &&
    input.speechAllowanceSeconds !== ""
  ) {
    const value = Number(input.speechAllowanceSeconds);
    if (!Number.isInteger(value) || value < 0) {
      errors.push("speechAllowanceSeconds must be a non-negative integer");
    } else {
      speechAllowanceSeconds = value;
    }
  }

  const plan = text(input.plan) || null;

  let quotas: Record<string, number> | null = null;
  if (input.quotas !== undefined && input.quotas !== null) {
    if (!isRecord(input.quotas)) {
      errors.push("quotas must be an object of positive numbers");
    } else {
      quotas = {};
      for (const [key, raw] of Object.entries(input.quotas)) {
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
          errors.push(`quota ${JSON.stringify(key)} must be a non-negative number`);
        } else {
          quotas[key] = raw;
        }
      }
    }
  }

  let branding: TenantBranding | null = null;
  if (input.branding !== undefined && input.branding !== null) {
    const validation = validateBranding(input.branding);
    if (!validation.ok) errors.push(...validation.errors);
    else branding = validation.branding;
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    draft: {
      name,
      slug,
      locale: locale as "vi" | "en",
      retentionDays,
      speechAllowanceSeconds,
      plan,
      quotas,
      branding,
    },
  };
}

export type CreateTenantResult =
  | { ok: true; tenant: TenantRow }
  | { ok: false; reason: "taken" };

export async function createTenant(draft: TenantDraft): Promise<CreateTenantResult> {
  const inserted = await getDb()
    .insert(tenants)
    .values({
      name: draft.name,
      slug: draft.slug,
      locale: draft.locale,
      retentionDays: draft.retentionDays,
      speechAllowanceSeconds: draft.speechAllowanceSeconds,
      plan: draft.plan,
      quotas: draft.quotas,
      branding: draft.branding as Record<string, unknown> | null,
    })
    .onConflictDoNothing({ target: tenants.slug })
    .returning();
  const tenant = inserted[0];
  return tenant === undefined ? { ok: false, reason: "taken" } : { ok: true, tenant };
}

export async function findTenant(id: string): Promise<TenantRow | undefined> {
  const rows = await getDb().select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0];
}

export async function listTenants(): Promise<TenantRow[]> {
  return getDb().select().from(tenants).orderBy(asc(tenants.name));
}

export async function setTenantStatus(
  id: string,
  status: TenantStatus
): Promise<TenantRow | undefined> {
  const rows = await getDb()
    .update(tenants)
    .set({ status })
    .where(eq(tenants.id, id))
    .returning();
  return rows[0];
}

export function suspendTenant(id: string): Promise<TenantRow | undefined> {
  return setTenantStatus(id, "suspended");
}

export function resumeTenant(id: string): Promise<TenantRow | undefined> {
  return setTenantStatus(id, "active");
}
