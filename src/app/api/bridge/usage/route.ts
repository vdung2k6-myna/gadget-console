import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { recordAdapterEgress } from "@/lib/adapter-egress";
import { bridgeAuthorized } from "@/lib/bridge/auth";
import { devices } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import { recordUsage } from "@/lib/tenancy/usage";

/**
 * What the runtime observed for its adapter calls, forwarded by the bridge.
 *
 * The bridge authenticated; the device row names the tenant, so an event cannot
 * be filed against another tenant even if the caller said otherwise. The input
 * has no field for text or audio, and none is read. Each event writes two rows:
 * the egress row is the audit, and the usage event is the meter the allowance
 * and quota read.
 */

const KINDS = new Set(["llm", "stt", "tts"]);
const STATUSES = new Set([
  "ok",
  "upstream",
  "timeout",
  "rate_limit",
  "refused",
  "error",
]);

/** The registry row a call names; anything else is not an adapter this console knows. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The meter records whole seconds; a fractional observation is rounded. */
function wholeSeconds(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.round(value));
}

/** The meter's kind: both speech kinds are one metered "speech". */
function usageKind(kind: "llm" | "stt" | "tts"): "llm" | "speech" {
  return kind === "llm" ? "llm" : "speech";
}

export async function POST(request: Request) {
  if (!bridgeAuthorized(request)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.deviceId !== "string" || !Array.isArray(body.events)) {
    return NextResponse.json({ error: "deviceId and events are required" }, { status: 400 });
  }
  if (body.events.length > 100) {
    return NextResponse.json({ error: "too many events in one report" }, { status: 400 });
  }

  const rows = await getDb()
    .select({ tenantId: devices.tenantId })
    .from(devices)
    .where(eq(devices.deviceId, body.deviceId.trim()))
    .limit(1);
  const tenantId = rows[0]?.tenantId;
  if (tenantId === undefined || tenantId === null) {
    return NextResponse.json({ error: "unknown device" }, { status: 404 });
  }

  const events: Array<{
    kind: "llm" | "stt" | "tts";
    /** Null is platform speech: a direct profile or the platform's fallback. */
    adapterId: string | null;
    status: string;
    latencyMs?: number;
    bytes?: number;
    audioSeconds?: number;
  }> = [];
  for (const entry of body.events) {
    if (!isRecord(entry)) {
      return NextResponse.json({ error: "an event must be an object" }, { status: 400 });
    }
    const kind = typeof entry.kind === "string" ? entry.kind : "";
    const status = typeof entry.status === "string" ? entry.status : "";
    const adapterId =
      typeof entry.adapterId === "string" && entry.adapterId.trim() !== ""
        ? entry.adapterId.trim()
        : null;
    if (!KINDS.has(kind) || !STATUSES.has(status) || (adapterId !== null && !UUID.test(adapterId))) {
      return NextResponse.json({ error: "an event is incomplete" }, { status: 400 });
    }
    const number = (value: unknown): number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
    events.push({
      kind: kind as "llm" | "stt" | "tts",
      adapterId,
      status,
      latencyMs: number(entry.latencyMs),
      bytes: number(entry.bytes),
      audioSeconds: number(entry.audioSeconds),
    });
  }

  for (const event of events) {
    await recordAdapterEgress({
      tenantId,
      adapterId: event.adapterId,
      kind: event.kind,
      status: event.status as
        | "ok"
        | "upstream"
        | "timeout"
        | "rate_limit"
        | "refused"
        | "error",
      latencyMs: event.latencyMs,
      bytes: event.bytes,
      audioSeconds: event.audioSeconds,
    });
    // A call with no adapter id is platform speech; one naming an adapter is
    // reseller speech. The platform bills only the former.
    await recordUsage({
      tenantId,
      kind: usageKind(event.kind),
      source: event.adapterId === null ? "platform" : "reseller",
      provider: event.adapterId,
      seconds: wholeSeconds(event.audioSeconds),
      bytes: Math.max(0, Math.round(event.bytes ?? 0)),
    });
  }

  return new NextResponse(null, { status: 204 });
}
