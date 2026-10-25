import { inArray, lt, sql } from "drizzle-orm";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { claims, devices, turns } from "@/lib/db/schema";

/**
 * Deletion the deployment does for itself.
 *
 * Everything here answers one question per row — "can anybody still act on
 * this?" — and deletes only when the answer is no. The run is a scheduled job
 * rather than something a request does, so a read never pays for cleanup, and
 * every statement is idempotent: two instances running it at once is a second
 * pass that finds nothing.
 */

export interface PrunedDevices {
  devices: number;
  /** Claims removed with the device rows, which have no cascade of their own. */
  claims: number;
}

/**
 * Removes device rows nobody owns, and the claims that name them.
 *
 * A row survives while it is young, while it has an owner, while a code on it is
 * still acceptable, or while a code somebody entered is still waiting for an
 * admin. The last condition is why this cannot be a plain age test: a request can
 * be hours old while the row it names is weeks old, and deleting the row would
 * strand a decision an admin is about to make.
 */
export async function pruneUnclaimedDevices(
  now: Date = new Date(),
  batch: number = loadConfig().pruneBatch
): Promise<PrunedDevices> {
  const { unclaimedDeviceTtlMs, claimApprovalTtlMs } = loadConfig();
  const ageCutoff = new Date(now.getTime() - unclaimedDeviceTtlMs);
  const approvalCutoff = new Date(now.getTime() - claimApprovalTtlMs);

  return getDb().transaction(async (tx) => {
    const removed = await tx.execute<{ deviceId: string }>(sql`
      delete from ${devices}
      where ${devices.id} in (
        select d.id
        from ${devices} d
        where d.user_id is null
          and d.created_at < ${ageCutoff}
          and not exists (
            select 1
            from ${claims} c
            where c.device_id = d.device_id
              and (
                (c.consumed_at is null and c.expires_at > ${now})
                or (
                  c.consumed_at is not null
                  and c.approved_at is null
                  and c.rejected_at is null
                  and c.consumed_at > ${approvalCutoff}
                )
              )
          )
        order by d.created_at
        limit ${batch}
      )
      returning ${devices.deviceId} as "deviceId"
    `);

    const deviceIds = removed.rows.map((row) => row.deviceId);
    if (deviceIds.length === 0) return { devices: 0, claims: 0 };

    const orphanedClaims = await tx
      .delete(claims)
      .where(inArray(claims.deviceId, deviceIds))
      .returning({ id: claims.id });

    return { devices: deviceIds.length, claims: orphanedClaims.length };
  });
}

/**
 * Removes claim rows nothing can be done with: a code that died without being
 * entered, a request nobody decided in time, or a decision old enough that its
 * record no longer explains anything.
 */
export async function pruneClaims(
  now: Date = new Date(),
  batch: number = loadConfig().pruneBatch
): Promise<number> {
  const { claimApprovalTtlMs } = loadConfig();
  const approvalCutoff = new Date(now.getTime() - claimApprovalTtlMs);

  const removed = await getDb().execute<{ id: string }>(sql`
    delete from ${claims}
    where ${claims.id} in (
      select c.id
      from ${claims} c
      where (
          c.consumed_at is null
          and c.expires_at < ${now}
        )
        or (
          c.consumed_at is not null
          and c.approved_at is null
          and c.rejected_at is null
          and c.consumed_at < ${approvalCutoff}
        )
        or (
          coalesce(c.approved_at, c.rejected_at) < ${approvalCutoff}
        )
      order by c.created_at
      limit ${batch}
    )
    returning ${claims.id} as "id"
  `);

  return removed.rows.length;
}

/**
 * Conversation records expire. The period is the deployment's (RETENTION_DAYS),
 * and the prune is a scheduled run rather than something a request does, so a
 * read never pays for cleanup.
 */
export async function pruneTurns(
  retentionDays = loadConfig().retentionDays,
  now = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await getDb()
    .delete(turns)
    .where(lt(turns.createdAt, cutoff))
    .returning({ id: turns.id });
  return deleted.length;
}

export interface PruneReport {
  devices: number;
  claims: number;
  turns: number;
}

/** Everything one scheduled pass removes, in the order the tables depend on. */
export async function pruneAll(now: Date = new Date()): Promise<PruneReport> {
  const config = loadConfig();
  const devicesPruned = await pruneUnclaimedDevices(now, config.pruneBatch);
  const claimsPruned = await pruneClaims(now, config.pruneBatch);
  const turnsPruned = await pruneTurns(config.retentionDays, now);
  return {
    devices: devicesPruned.devices,
    claims: devicesPruned.claims + claimsPruned,
    turns: turnsPruned,
  };
}
