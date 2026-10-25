import { eq } from "drizzle-orm";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { agents, devices, users } from "@/lib/db/schema";

/**
 * Accounts, and the one thing about them the deployment may change.
 *
 * A role is granted here and nowhere else: `setRole` is reached only by the
 * command in `scripts/role.ts`, so no route, page or form can make an account an
 * admin. That is the whole of the guard against "become an admin" being a
 * permission somebody could request.
 */

export const ROLES = ["user", "admin"] as const;

/**
 * Accounts that can never be returned to a user — the deployment's own, so the
 * admin area cannot be lost by a click, a mistake, or a script.
 *
 * The addresses come from the deployment's environment (`PROTECTED_ADMINS`),
 * not from this file: the repository is published, and the account it guards is
 * nobody else's business. The setting is read where it is used, so changing it
 * needs a restart and nothing else — it is not reachable from any route, page or
 * form, and `setRole` and the admin area both refuse these accounts, so the
 * command is not a way round the rule either.
 */
export function isProtectedAdmin(email: string): boolean {
  return loadConfig().protectedAdmins.includes(email.trim().toLowerCase());
}
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export type SetRoleResult =
  | { ok: true; email: string; previous: Role; role: Role }
  | { ok: false; reason: "unknown-role" | "no-such-account" | "protected" };

export async function setRole(rawEmail: string, rawRole: string): Promise<SetRoleResult> {
  if (!isRole(rawRole)) return { ok: false, reason: "unknown-role" };

  const email = rawEmail.trim().toLowerCase();
  const existing = await getDb()
    .select({ role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const account = existing[0];
  if (account === undefined) return { ok: false, reason: "no-such-account" };
  if (rawRole === "user" && isProtectedAdmin(email)) return { ok: false, reason: "protected" };

  await getDb().update(users).set({ role: rawRole }).where(eq(users.email, email));
  return { ok: true, email, previous: account.role as Role, role: rawRole };
}

export type RoleChangeResult =
  | { ok: true }
  | { ok: false; reason: "unknown-role" | "not-found" | "last-admin" | "protected" };

/**
 * An admin changing another account's role from the admin area.
 *
 * The boundary the command had is kept: only an account already an admin can
 * reach this, and the console refuses to remove the last one — a single click
 * must not be able to lock every admin out. The deployment's command remains the
 * way back if it ever happens another way.
 */
export async function changeRoleAsAdmin(
  adminEmail: string,
  targetUserId: string,
  rawRole: string
): Promise<RoleChangeResult> {
  if (!isRole(rawRole)) return { ok: false, reason: "unknown-role" };

  const rows = await getDb()
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  const target = rows[0];
  if (target === undefined) return { ok: false, reason: "not-found" };
  if (target.role === rawRole) return { ok: true };
  if (rawRole === "user" && isProtectedAdmin(target.email)) return { ok: false, reason: "protected" };

  if (target.role === "admin" && rawRole === "user") {
    const admins = await getDb().select({ id: users.id }).from(users).where(eq(users.role, "admin"));
    if (admins.length <= 1) return { ok: false, reason: "last-admin" };
  }

  await getDb().update(users).set({ role: rawRole }).where(eq(users.id, targetUserId));
  console.log(`[admin] ${adminEmail} set ${target.email} to ${rawRole}`);
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

/** Every account, with what it owns. The admin area's account list. */
export async function listAccounts(): Promise<AdminAccount[]> {
  const rows = await getDb()
    .select({ id: users.id, email: users.email, role: users.role, createdAt: users.createdAt })
    .from(users);

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
