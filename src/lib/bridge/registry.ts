import { desc, eq } from "drizzle-orm";
import { findRuntime } from "@/lib/runtimes";
import { getDb } from "@/lib/db/client";
import { agents, devices, turns } from "@/lib/db/schema";
import { allowClaimIssue, awaitingApproval, issueClaim, isPendingClaim, normalizeDeviceId } from "@/lib/claims";
import { profileForAgent } from "@/lib/crypto/profiles";

/**
 * What the bridge asks the console, and what the console answers.
 *
 * One call answers everything a session needs: whether the gadget is owned, the
 * agent that answers it (with its runtime address and credential), the device's
 * own secret, its partner, and the turns already recorded. That is deliberate —
 * a connection resolves once, and the turn path then reads nothing.
 *
 * The device's secret is returned for an unowned gadget too, because the bridge
 * issues its socket token *before* activation; a secret that appeared only at
 * claim time would make that token stale.
 */

export const HISTORY_TURNS = 20;

export type Resolution =
  | { kind: "owned"; body: Record<string, unknown> }
  | { kind: "unowned"; body: Record<string, unknown> }
  | { kind: "rate-limited" };

export async function resolveDevice(rawDeviceId: string): Promise<Resolution> {
  const deviceId = normalizeDeviceId(rawDeviceId);
  const rows = await getDb().select().from(devices).where(eq(devices.deviceId, deviceId)).limit(1);
  const device = rows[0];

  if (device === undefined || device.userId === null) {
    if (!allowClaimIssue(deviceId)) return { kind: "rate-limited" };
    const claim = await issueClaim(deviceId);
    const secret = await currentSecret(deviceId);
    return {
      kind: "unowned",
      body: {
        deviceId,
        owned: false,
        secret,
        ...(claim === undefined
          ? {}
          : { activation: { code: claim.code, expiresAt: claim.expiresAt.toISOString() } }),
      },
    };
  }

  await getDb()
    .update(devices)
    .set({ lastSeenAt: new Date() })
    .where(eq(devices.id, device.id));

  const agent = device.agentId === null ? undefined : await agentWithRuntime(device.agentId, device.userId!);
  const history = await getDb()
    .select()
    .from(turns)
    .where(eq(turns.deviceId, device.id))
    .orderBy(desc(turns.startedAt))
    .limit(HISTORY_TURNS);

  const partner = device.partnerDeviceId === null ? null : await partnerDeviceId(device.partnerDeviceId);

  return {
    kind: "owned",
    body: {
      deviceId,
      owned: true,
      deviceRowId: device.id,
      secret: device.secret,
      partner,
      agent:
        agent === undefined
          ? null
          : {
              id: agent.id,
              name: agent.name,
              systemPrompt: agent.systemPrompt,
              language: agent.language,
              engine: agent.engine,
              answerMode: agent.answerMode,
              topics: agent.topics,
              runtime: agent.runtime,
              // The account's own model, or null for the runtime's default. The
              // key is decrypted here and nowhere else.
              llm: agent.llm,
            },
      // Oldest first: this is what a turn's history is built from.
      turns: history.reverse().map((turn) => ({
        userText: turn.userText,
        assistantText: turn.assistantText,
        language: turn.language,
        engine: turn.engine,
        startedAt: turn.startedAt.toISOString(),
        endedAt: turn.endedAt.toISOString(),
      })),
    },
  };
}

async function currentSecret(deviceId: string): Promise<string> {
  const rows = await getDb()
    .select({ secret: devices.secret })
    .from(devices)
    .where(eq(devices.deviceId, deviceId))
    .limit(1);
  return rows[0]!.secret;
}

function agentWithRuntime(agentId: string, userId: string) {
  return getDb()
    .select({
      id: agents.id,
      name: agents.name,
      systemPrompt: agents.systemPrompt,
      language: agents.language,
      engine: agents.engine,
      answerMode: agents.answerMode,
      topics: agents.topics,
      runtimeId: agents.runtimeId,
      llmProfileId: agents.llmProfileId,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1)
    .then(async (rows) => {
      const agent = rows[0];
      if (agent === undefined) return undefined;
      const runtime = await findRuntime(agent.runtimeId);
      if (runtime === undefined) return undefined;
      const llm = await profileForAgent(userId, agent.llmProfileId);
      const { runtimeId: _runtimeId, llmProfileId: _llmProfileId, ...fields } = agent;
      return {
        ...fields,
        llm,
        runtime: { baseUrl: runtime.baseUrl, token: runtime.token },
      };
    });
}

async function partnerDeviceId(rowId: string): Promise<string | null> {
  const rows = await getDb()
    .select({ deviceId: devices.deviceId })
    .from(devices)
    .where(eq(devices.id, rowId))
    .limit(1);
  return rows[0]?.deviceId ?? null;
}

export type ActivationState = "owned" | "pending" | "unknown" | "rate-limited";

/** What `POST /activate` answers the gadget's polling with. */
export async function activationState(rawDeviceId: string): Promise<ActivationState> {
  const deviceId = normalizeDeviceId(rawDeviceId);
  const rows = await getDb().select().from(devices).where(eq(devices.deviceId, deviceId)).limit(1);
  const device = rows[0];
  if (device === undefined) return "unknown";
  if (device.userId !== null) return "owned";
  // A code shown, or a code entered and waiting for an admin: both mean "keep
  // waiting" to the gadget, which polls `/activate` until it hears 200.
  if ((await awaitingApproval(deviceId)) !== undefined) return "pending";
  return (await isPendingClaim(deviceId)) ? "pending" : "unknown";
}

export interface TurnRecord {
  deviceId: string;
  userText: string;
  assistantText: string;
  language: string;
  engine: string;
  startedAt: Date;
  endedAt: Date;
}

export type RecordResult =
  | { ok: true; id: string }
  | { ok: false; reason: "device-not-found" | "invalid" };

/** Stores one served turn. Text only; a turn that was not served is not one. */
export async function recordTurn(input: unknown): Promise<RecordResult> {
  if (typeof input !== "object" || input === null) return { ok: false, reason: "invalid" };
  const body = input as Record<string, unknown>;

  const deviceId = typeof body.deviceId === "string" ? normalizeDeviceId(body.deviceId) : "";
  if (deviceId === "") return { ok: false, reason: "invalid" };

  const userText = typeof body.userText === "string" ? body.userText : undefined;
  const assistantText = typeof body.assistantText === "string" ? body.assistantText : undefined;
  const language = typeof body.language === "string" ? body.language : "";
  const engine = typeof body.engine === "string" ? body.engine : "";
  const startedAt = dateValue(body.startedAt);
  const endedAt = dateValue(body.endedAt);

  if (
    userText === undefined ||
    assistantText === undefined ||
    language === "" ||
    engine === "" ||
    startedAt === undefined ||
    endedAt === undefined
  ) {
    return { ok: false, reason: "invalid" };
  }

  const rows = await getDb()
    .select({ id: devices.id, userId: devices.userId })
    .from(devices)
    .where(eq(devices.deviceId, deviceId))
    .limit(1);
  const device = rows[0];
  // A gadget nobody owns records nothing: there was no owner to record it for.
  if (device === undefined || device.userId === null) return { ok: false, reason: "device-not-found" };

  const inserted = await getDb()
    .insert(turns)
    .values({
      deviceId: device.id,
      userText,
      assistantText,
      language,
      engine,
      startedAt,
      endedAt,
    })
    .returning({ id: turns.id });

  return { ok: true, id: inserted[0]!.id };
}

function dateValue(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
