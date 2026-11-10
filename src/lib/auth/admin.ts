import { notFound } from "next/navigation";
import { connection } from "next/server";
import { currentUser } from "./guard";
import {
  canSupport,
  isAdminRole,
  isPlatformAdmin,
  isSupportRole,
  isTenantAdmin,
} from "./roles";
import type { SessionUser } from "./session";

/**
 * The admin gate, on its own surface.
 *
 * A user is answered with the not-found page rather than a refusal, for the same
 * reason a foreign device is: whether an admin area exists is not something a
 * normal account should learn from a status code.
 *
 * The role is read from the account row on every request — `currentUser` selects
 * it — so an account demoted while signed in loses the area on its next request.
 *
 * `connection()` first, for the same reason the session gate has it: this reads
 * the session, and the session's expiry is compared against now. The
 * route-handler form below does not need it — a handler has no prerender pass.
 */
export async function requireAdmin(): Promise<SessionUser> {
  await connection();
  const user = await currentUser();
  // `admin` is the legacy single-deployment role; the backfill maps it to
  // `tenant_admin`, and the old value stays accepted until the role task removes
  // it from the management surface.
  if (user === undefined || (!isAdminRole(user.role) && user.role !== "admin")) notFound();
  return user;
}

/** The route-handler form: `undefined` for anybody who is not an admin. */
export async function currentAdmin(): Promise<SessionUser | undefined> {
  const user = await currentUser();
  return user !== undefined && (isAdminRole(user.role) || user.role === "admin")
    ? user
    : undefined;
}

/** The platform operator: tenants, plans, usage, and support across tenants. */
export async function requirePlatformAdmin(): Promise<SessionUser> {
  await connection();
  const user = await currentUser();
  if (user === undefined || !isPlatformAdmin(user.role)) notFound();
  return user;
}

export async function currentPlatformAdmin(): Promise<SessionUser | undefined> {
  const user = await currentUser();
  return user !== undefined && isPlatformAdmin(user.role) ? user : undefined;
}

/** A reseller's own administrator. */
export async function requireTenantAdmin(): Promise<SessionUser> {
  await connection();
  const user = await currentUser();
  if (user === undefined || !isTenantAdmin(user.role)) notFound();
  return user;
}

export async function currentTenantAdmin(): Promise<SessionUser | undefined> {
  const user = await currentUser();
  return user !== undefined && isTenantAdmin(user.role) ? user : undefined;
}

/** A read-only support surface: support, tenant admin or platform admin. */
export async function requireSupport(): Promise<SessionUser> {
  await connection();
  const user = await currentUser();
  if (user === undefined || (!canSupport(user.role) && user.role !== "admin")) notFound();
  return user;
}

export async function currentSupport(): Promise<SessionUser | undefined> {
  const user = await currentUser();
  return user !== undefined && (canSupport(user.role) || user.role === "admin")
    ? user
    : undefined;
}
