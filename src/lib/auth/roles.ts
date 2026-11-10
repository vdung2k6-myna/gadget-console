/**
 * The tenant role set.
 *
 * The `users.role` column is text, and the legacy single-deployment roles
 * (`user`, `admin`) are migrated by the tenancy backfill: a deployment admin
 * becomes a tenant admin, and the operator named in the deployment settings
 * becomes a platform admin. The old management routes are updated in the roles
 * task; this module is the one definition the rest of the tenant code uses.
 */

export const USER_ROLES = ["platform_admin", "tenant_admin", "support", "user"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function isPlatformAdmin(role: string): boolean {
  return role === "platform_admin";
}

export function isTenantAdmin(role: string): boolean {
  return role === "tenant_admin";
}

/** The roles that may administer something; the platform admin is the wider one. */
export function isAdminRole(role: string): boolean {
  return isPlatformAdmin(role) || isTenantAdmin(role);
}

export function isSupportRole(role: string): boolean {
  return role === "support";
}

/** The roles allowed to reach a support surface: both admins and support. */
export function canSupport(role: string): boolean {
  return isAdminRole(role) || isSupportRole(role);
}

/**
 * Whether this account may read or act on a tenant's records.
 *
 * A platform admin oversees every tenant; every other account is confined to
 * its own. The tenant id is the resolved one, never a value from the request.
 */
export function canAccessTenant(
  user: { role: string; tenantId: string | null },
  tenantId: string
): boolean {
  return isPlatformAdmin(user.role) || user.tenantId === tenantId;
}
