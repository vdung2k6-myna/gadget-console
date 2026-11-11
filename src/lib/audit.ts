import { and, desc, eq, like } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { auditEvents } from "@/lib/db/schema";

/**
 * The durable audit.
 *
 * `recordAudit` inserts; nothing here updates or deletes a row. A caller that
 * needs history rewritten is asking for the wrong thing.
 */

export type AuditEventRow = typeof auditEvents.$inferSelect;

export interface AuditInput {
  tenantId?: string | null;
  actorId?: string | null;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown> | null;
}

export async function recordAudit(input: AuditInput): Promise<AuditEventRow> {
  const rows = await getDb()
    .insert(auditEvents)
    .values({
      tenantId: input.tenantId ?? null,
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata ?? null,
    })
    .returning();
  return rows[0]!;
}

export async function findAuditEvent(id: string): Promise<AuditEventRow | undefined> {
  const rows = await getDb()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.id, id))
    .limit(1);
  return rows[0];
}

export async function listTenantAudit(
  tenantId: string,
  options: { limit?: number; actionPrefix?: string } = {}
): Promise<AuditEventRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const where =
    options.actionPrefix === undefined
      ? eq(auditEvents.tenantId, tenantId)
      : and(
          eq(auditEvents.tenantId, tenantId),
          like(auditEvents.action, `${options.actionPrefix}%`)
        );

  return getDb()
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.at))
    .limit(limit);
}
