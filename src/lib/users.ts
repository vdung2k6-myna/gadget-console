import { and, eq } from "drizzle-orm";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { agents, devices, users } from "@/lib/db/schema";
import {
  isAdminRole,
  isPlatformAdmin,
  isUserRole,
  USER_ROLES,
  type UserRole,
} from "@/lib/auth/roles";

/**
 * Accounts, and the one thing about them the deployment may change.
 *
 * A role is granted here and nowhere else: `setRole` is reached only by the
 * command in `scripts/role.ts`, and `changeRoleAsAdmin` only from the admin
 * area. A tenant admin is confined to its own tenant; the platform admin may
 * act across tenants but cannot demolish the last platform admin.
 */

export const ROLES = USER_ROLES;
export type Role = UserRole;

/**
 * Accounts that can never be demoted from platform admin — the deployment's own,
 * so the platform area cannot be lost by a click, a mistake, or a script.
 */
export function isProtectedAdmin(email: string): boolean {
  return loadConfig().protectedAdmins.includes(email.trim().toLowerCase());
}

export function isRole(value: unknown): value is Role {
  return isUserRole(value);
}

export type SetRoleResult =
  | { ok: true; email: string; previous: Role; role: Role }
  | { ok: false; reason: "unknown-role" | "no-such-account" | "protected" | "no-tenant" };

export async function setRole(rawEmail: string, rawRole: string): Promise<SetRoleResult> {
  if (!isRole(rawRole)) return { ok: false, reason: "unknown-role" };

  const email = rawEmail.trim().toLowerCase();
  const existing = await getDb()
    .select({ role: users.role, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const account = existing[0];
  if (account === undefined) return { ok: false, reason: "no-such-account" };
  if (isProtectedAdmin(email) && rawRole !== "platform_admin") {
    return { ok: false, reason: "protected" };
  }
  if (rawRole !== "platform_admin" && account.tenantId === null) {
    return { ok: false, reason: "no-tenant" };
  }

  if (
    account.role === rawRole &&
    (rawRole === "platform_admin" ? account.tenantId === null : account.tenantId !== null)
  ) {
    return { ok: true, email, previous: account.role as Role, role: rawRole };
  }

  await getDb()
    .update(users)
    .set({
      role: rawRole,
      ...(rawRole === "platform_admin" ? { tenantId: null } : {}),
    })
    .where(eq(users.email, email));
  return { ok: true, email, previous: account.role as Role, role: rawRole };
}

export interface RoleAdmin {
  email: string;
  role: string;
  tenantId: string | null;
}

export type RoleChangeResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unknown-role" | "not-found" | "last-admin" | "protected" | "no-tenant";
    };

/**
 * An admin changing another account's role from the admin area.
 *
 * A tenant admin may change only an account in its own tenant and may not grant
 * the platform role. A platform admin may act across tenants, but neither may
 * remove the last platform admin, and a tenant admin may not remove the last
 * tenant admin of its tenant.
 */
export async function changeRoleAsAdmin(
  admin: RoleAdmin,
  targetUserId: string,
  rawRole: string
): Promise<RoleChangeResult> {
  if (!isRole(rawRole)) return { ok: false, reason: "unknown-role" };
  if (!isAdminRole(admin.role) && admin.role !== "admin") {
    return { ok: false, reason: "not-found" };
  }

  const rows = await getDb()
    .select({ id: users.id, email: users.email, role: users.role, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  const target = rows[0];
  if (target === undefined) return { ok: false, reason: "not-found" };

  if (!isPlatformAdmin(admin.role)) {
    if (admin.tenantId === null || target.tenantId !== admin.tenantId) {
      return { ok: false, reason: "not-found" };
    }
    if (rawRole === "platform_admin") return { ok: false, reason: "not-found" };
  }

  if (isProtectedAdmin(target.email) && rawRole !== "platform_admin") {
    return { ok: false, reason: "protected" };
  }

  if (target.role === "platform_admin" && rawRole !== "platform_admin") {
    const platformAdmins = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "platform_admin"));
    if (platformAdmins.length <= 1) return { ok: false, reason: "last-admin" };
  }

  if (target.role === "tenant_admin" && rawRole !== "tenant_admin") {
    if (target.tenantId === null) return { ok: false, reason: "no-tenant" };
    const tenantAdmins = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "tenant_admin"), eq(users.tenantId, target.tenantId)));
    if (tenantAdmins.length <= 1) return { ok: false, reason: "last-admin" };
  }

  // A platform admin has no tenant, so it can only be demoted by first being
  // given one; the admin area does not assign tenants yet.
  if (rawRole !== "platform_admin" && target.tenantId === null) {
    return { ok: false, reason: "no-tenant" };
  }

  const nextTenantId = rawRole === "platform_admin" ? null : target.tenantId;
  await getDb()
    .update(users)
    .set({ role: rawRole, tenantId: nextTenantId })
    .where(eq(users.id, targetUserId));
  console.log(`[admin] ${admin.email} set ${target.email} to ${rawRole}`);
  return { ok: true };
}

export interface AdminAccount {
  id: string;
  email: string;
  role: Role;
  createdAt: Date;
  devices: number;
  agents: number;
}

/** Accounts with what they own; a tenant id limits the list to that tenant. */
export async function listAccounts(tenantId?: string): Promise<AdminAccount[]> {
  const rows =
    tenantId === undefined
      ? await getDb()
          .select({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt })
          .from(users)
      : await getDb()
          .select({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt })
          .from(users)
          .where(eq(users.tenantId, tenantId));

  const ownedDevices = await getDb().select({ userId: devices.userId }).from(devices);
  const ownedAgents = await getDb().select({ userId: agents.userId }).from(agents);

  const count = (entries: { userId: string | null }[], userId: string): number =>
    entries.filter((entry) => entry.userId === userId).length;

  return rows
    .map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role as Role,
      createdAt: row.createdAt,
      devices: count(ownedDevices, row.id),
      agents: count(ownedAgents, row.id),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}
