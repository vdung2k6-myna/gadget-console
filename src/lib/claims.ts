import { randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { claims, conversations, devices, turns, users } from "@/lib/db/schema";

/**
 * Claiming a gadget.
 *
 * A device row exists before it has an owner, because the firmware connects with
 * the token it was given before activation — a secret created at claim time
 * would make that token stale. So the first OTA for an unknown identifier
 * creates the row and its secret, and a short code that a person reads off the
 * gadget's display.
 *
 * The code is the only thing standing between "somebody knows a MAC" and "the
 * person holding the gadget owns it", and it is not a strong barrier: whoever
 * knows the identifier can ask for the same code. What narrows the window is
 * that the code expires, is single-use, is rate-limited, and is shown *and
 * spoken* by the physical gadget.
 */

export const CLAIM_CODE_DIGITS = 6;
const CLAIM_ATTEMPTS = 10;
const RATE_LIMIT_ISSUES = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/** The bridge normalizes the same way; both sides must agree byte for byte. */
export function normalizeDeviceId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[-:\s]/g, "");
}

export function newDeviceSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function newClaimCode(): string {
  return String(randomInt(0, 10 ** CLAIM_CODE_DIGITS)).padStart(CLAIM_CODE_DIGITS, "0");
}

export interface IssuedClaim {
  code: string;
  expiresAt: Date;
}

export function findOwnedDevice(deviceId: string) {
  return getDb()
    .select()
    .from(devices)
    .where(eq(devices.deviceId, normalizeDeviceId(deviceId)))
    .limit(1);
}

/** A live claim for this identifier, if one is already waiting. */
export async function findLiveClaim(deviceId: string) {
  const rows = await getDb()
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.deviceId, normalizeDeviceId(deviceId)),
        isNull(claims.consumedAt),
        gt(claims.expiresAt, new Date())
      )
    )
    .limit(1);
  return rows[0];
}

export async function isPendingClaim(deviceId: string): Promise<boolean> {
  return (await findLiveClaim(deviceId)) !== undefined;
}

/**
 * Issues (or reuses) a claim code for a gadget nobody owns. An owned gadget gets
 * none: returning a code would invite a second claim on a device that already
 * has an owner.
 */
export async function issueClaim(
  deviceId: string
): Promise<IssuedClaim | undefined> {
  const normalized = normalizeDeviceId(deviceId);

  const deviceRows = await getDb()
    .select()
    .from(devices)
    .where(eq(devices.deviceId, normalized))
    .limit(1);
  const device = deviceRows[0];

  if (device !== undefined && device.userId !== null) return undefined;

  if (device === undefined) {
    await getDb()
      .insert(devices)
      .values({ deviceId: normalized, secret: newDeviceSecret() })
      .onConflictDoNothing({ target: devices.deviceId });
  }

  // A gadget whose code has been entered is waiting for an admin, not for another
  // code: showing a second one would invite the person to enter it as well.
  if ((await awaitingApproval(normalized)) !== undefined) return undefined;

  const live = await findLiveClaim(normalized);
  if (live !== undefined) return { code: live.code, expiresAt: live.expiresAt };

  const code = await unusedCode();
  const expiresAt = new Date(Date.now() + loadConfig().claimTtlMs);
  await getDb().insert(claims).values({ deviceId: normalized, code, expiresAt });
  return { code, expiresAt };
}

async function unusedCode(): Promise<string> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    const code = newClaimCode();
    const clash = await getDb()
      .select({ id: claims.id })
      .from(claims)
      .where(and(eq(claims.code, code), isNull(claims.consumedAt), gt(claims.expiresAt, new Date())))
      .limit(1);
    if (clash[0] === undefined) return code;
  }
  throw new Error(`could not find an unused ${CLAIM_CODE_DIGITS}-digit code`);
}

export type ClaimResult =
  | { ok: true; device: typeof devices.$inferSelect }
  | { ok: false; reason: "invalid" | "expired" | "taken" };

/**
 * Entering a code. The claim row is locked, so two accounts entering the same
 * code at the same moment leave exactly one request: the second sees it consumed.
 * Nothing is owned yet — an admin approves the request (`approveClaim`).
 */
export async function claimDevice(userId: string, code: string): Promise<ClaimResult> {
  const normalizedCode = code.trim();
  if (normalizedCode === "") return { ok: false, reason: "invalid" };

  return getDb().transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.code, normalizedCode), isNull(claims.consumedAt)))
      .for("update")
      .limit(1);

    const claim = claimRows[0];
    if (claim === undefined) return { ok: false, reason: "invalid" as const };
    if (claim.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" as const };

    const deviceRows = await tx
      .select()
      .from(devices)
      .where(eq(devices.deviceId, claim.deviceId))
      .for("update")
      .limit(1);
    const device = deviceRows[0];
    if (device === undefined) return { ok: false, reason: "invalid" as const };
    if (device.userId !== null) return { ok: false, reason: "taken" as const };

    // The code is used, and the account is recorded as the requester — but the
    // device does not change hands until an admin approves it.
    await tx
      .update(claims)
      .set({ consumedAt: new Date(), userId })
      .where(eq(claims.id, claim.id));

    return { ok: true as const, device };
  });
}

/** A request that has been entered and is waiting for an admin. */
export interface PendingRequest {
  claimId: string;
  deviceId: string;
  deviceRowId: string;
  requesterEmail: string;
  requesterId: string;
  requestedAt: Date;
  expiresAt: Date;
}

/**
 * The request waiting for this device, if there is one. Expired requests are not
 * returned: the approval window is its own, longer than the code's, because an
 * admin is not always at the desk when a person types the digits.
 */
export async function awaitingApproval(rawDeviceId: string) {
  const cutoff = new Date(Date.now() - loadConfig().claimApprovalTtlMs);
  const rows = await getDb()
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.deviceId, normalizeDeviceId(rawDeviceId)),
        isNotNull(claims.consumedAt),
        isNull(claims.approvedAt),
        isNull(claims.rejectedAt),
        gt(claims.consumedAt, cutoff)
      )
    )
    .orderBy(desc(claims.consumedAt))
    .limit(1);
  return rows[0];
}

async function pendingRows(where: ReturnType<typeof eq> | undefined): Promise<PendingRequest[]> {
  const cutoff = new Date(Date.now() - loadConfig().claimApprovalTtlMs);
  const query = getDb()
    .select({
      claimId: claims.id,
      deviceId: claims.deviceId,
      deviceRowId: devices.id,
      requesterEmail: users.email,
      requesterId: users.id,
      requestedAt: claims.consumedAt,
      expiresAt: claims.consumedAt,
    })
    .from(claims)
    .innerJoin(devices, eq(devices.deviceId, claims.deviceId))
    .innerJoin(users, eq(users.id, claims.userId))
    .where(
      and(
        isNotNull(claims.consumedAt),
        isNull(claims.approvedAt),
        isNull(claims.rejectedAt),
        gt(claims.consumedAt, cutoff),
        ...(where === undefined ? [] : [where])
      )
    )
    .orderBy(desc(claims.consumedAt));

  const rows = await query;
  const window = loadConfig().claimApprovalTtlMs;
  return rows.map((row) => ({
    ...row,
    requestedAt: row.requestedAt!,
    expiresAt: new Date(row.requestedAt!.getTime() + window),
  }));
}

/** The requests one account has made, for its own device list. */
export async function pendingRequestsFor(userId: string): Promise<PendingRequest[]> {
  return pendingRows(eq(claims.userId, userId));
}

/** Every request waiting for an admin. */
export async function listPendingRequests(): Promise<PendingRequest[]> {
  return pendingRows(undefined);
}

export type ApprovalResult = "approved" | "rejected" | "not-found" | "taken" | "expired";

/**
 * An admin approving a request: the device changes hands here, and nowhere else.
 * Approved whole or refused whole — a claim that arrives after the device was
 * claimed by somebody else is not applied over them.
 */
export async function approveClaim(adminEmail: string, claimId: string): Promise<ApprovalResult> {
  const outcome = await getDb().transaction(async (tx) => {
    const claimRows = await tx.select().from(claims).where(eq(claims.id, claimId)).for("update").limit(1);
    const claim = claimRows[0];
    if (claim === undefined || claim.consumedAt === null || claim.userId === null) {
      return "not-found" as const;
    }
    if (claim.approvedAt !== null || claim.rejectedAt !== null) return "not-found" as const;
    if (claim.consumedAt.getTime() + loadConfig().claimApprovalTtlMs <= Date.now()) {
      return "expired" as const;
    }

    const deviceRows = await tx
      .select()
      .from(devices)
      .where(eq(devices.deviceId, claim.deviceId))
      .for("update")
      .limit(1);
    const device = deviceRows[0];
    if (device === undefined) return "not-found" as const;
    if (device.userId !== null) return "taken" as const;

    await tx.update(claims).set({ approvedAt: new Date() }).where(eq(claims.id, claim.id));
    await tx.update(devices).set({ userId: claim.userId }).where(eq(devices.id, device.id));
    return "approved" as const;
  });

  if (outcome === "approved") {
    const rows = await getDb()
      .select({ deviceId: claims.deviceId, email: users.email })
      .from(claims)
      .innerJoin(users, eq(users.id, claims.userId))
      .where(eq(claims.id, claimId));
    console.log(`[admin] ${adminEmail} approved claim for ${rows[0]?.deviceId} to ${rows[0]?.email}`);
  }
  return outcome;
}

export async function rejectClaim(adminEmail: string, claimId: string): Promise<ApprovalResult> {
  const rows = await getDb()
    .select()
    .from(claims)
    .where(eq(claims.id, claimId))
    .limit(1);
  const claim = rows[0];
  if (claim === undefined || claim.consumedAt === null || claim.approvedAt !== null) return "not-found";
  if (claim.rejectedAt !== null) return "not-found";

  await getDb().update(claims).set({ rejectedAt: new Date() }).where(eq(claims.id, claimId));
  console.log(`[admin] ${adminEmail} rejected claim for ${claim.deviceId}`);
  return "rejected";
}

/**
 * Releasing a gadget. The owner, the agent and the pairing go; the secret is
 * replaced, so the credential the device holds stops working; and the record of
 * what was said to it goes with it.
 */
export async function releaseDevice(userId: string, deviceRowId: string): Promise<boolean> {
  const rows = await getDb()
    .select()
    .from(devices)
    .where(and(eq(devices.id, deviceRowId), eq(devices.userId, userId)))
    .limit(1);
  const device = rows[0];
  if (device === undefined) return false;

  await getDb().transaction(async (tx) => {
    if (device.partnerDeviceId !== null) {
      await tx
        .update(devices)
        .set({ partnerDeviceId: null })
        .where(eq(devices.id, device.partnerDeviceId));
    }
    // Turns and conversations belong to the device row, which stays (unowned) so
    // its next OTA can issue a fresh code; so they are deleted explicitly.
    await tx.delete(turns).where(eq(turns.deviceId, device.id));
    await tx.delete(conversations).where(eq(conversations.deviceId, device.id));
    await tx.delete(claims).where(eq(claims.deviceId, device.deviceId));
    await tx
      .update(devices)
      .set({
        userId: null,
        agentId: null,
        partnerDeviceId: null,
        secret: newDeviceSecret(),
      })
      .where(eq(devices.id, device.id));
  });

  return true;
}

const issueLog = new Map<string, number[]>();

/** Per-identifier rate limit for claim issuance; a burst must not grow the table. */
export function allowClaimIssue(deviceId: string, now = Date.now()): boolean {
  const key = normalizeDeviceId(deviceId);
  const recent = (issueLog.get(key) ?? []).filter((stamp) => now - stamp < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_ISSUES) {
    issueLog.set(key, recent);
    return false;
  }
  recent.push(now);
  issueLog.set(key, recent);
  return true;
}

/** Test seam: the limiter is process state, and tests run several cases in one. */
export function resetClaimRateLimit(): void {
  issueLog.clear();
}
