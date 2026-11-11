/**
 * A device's speech-gate calibration, over the deployment default.
 *
 * The console is the source of truth: the bridge resolves a gadget on every connection, so the
 * value it is told here is the one every replica uses. A device's own pair wins; without one it
 * gets the deployment default, which is seeded from the console's environment the first time it
 * is read. Every change leaves an audit row with the pair that was in effect before it.
 */

import { and, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { calibrationAudit, calibrationDefault, deviceCalibration, devices } from "@/lib/db/schema";

export interface CalibrationPair {
  threshold: number;
  minFrames: number;
}

export interface CalibrationView {
  effective: CalibrationPair;
  source: "device" | "default";
  device: CalibrationPair | null;
  default: CalibrationPair;
}

const DEFAULT_ID = "default";

/** Seeded from the console's environment on first read; the deployment's own starting point. */
function seededDefault(): CalibrationPair {
  const threshold = Number(process.env.CALIBRATION_DEFAULT_THRESHOLD ?? 0.5);
  const minFrames = Number(process.env.CALIBRATION_DEFAULT_MIN_FRAMES ?? 3);
  return {
    threshold: Number.isFinite(threshold) && threshold > 0 && threshold < 1 ? threshold : 0.5,
    minFrames: Number.isInteger(minFrames) && minFrames >= 1 ? minFrames : 3,
  };
}

/** The pair a write must carry, or the fields that are wrong. */
export function validatePair(
  body: unknown
): { ok: true; pair: CalibrationPair } | { ok: false; errors: string[] } {
  if (body === null || typeof body !== "object") {
    return { ok: false, errors: ["the body must be an object"] };
  }
  const fields = body as Record<string, unknown>;
  const threshold = Number(fields["threshold"]);
  const minFrames = Number(fields["minFrames"]);
  const errors: string[] = [];
  if (typeof fields["threshold"] !== "number" || !Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) {
    errors.push("threshold must be a number strictly between 0 and 1");
  }
  if (
    typeof fields["minFrames"] !== "number" ||
    !Number.isInteger(minFrames) ||
    minFrames < 1
  ) {
    errors.push("minFrames must be an integer of at least 1");
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, pair: { threshold, minFrames } };
}

export async function getDefaultPair(): Promise<CalibrationPair> {
  const db = getDb();
  const rows = await db
    .select()
    .from(calibrationDefault)
    .where(eq(calibrationDefault.id, DEFAULT_ID))
    .limit(1);
  const row = rows[0];
  if (row !== undefined) return { threshold: row.threshold, minFrames: row.minFrames };

  const seed = seededDefault();
  await db
    .insert(calibrationDefault)
    .values({ id: DEFAULT_ID, threshold: seed.threshold, minFrames: seed.minFrames })
    .onConflictDoNothing();
  return seed;
}

/** A device row by the console's id (a page) or by the firmware's `Device-Id` (the bridge). */
async function findDevice(
  ref: { id: string } | { deviceId: string }
): Promise<{ id: string; tenantId: string } | undefined> {
  const column = "id" in ref ? devices.id : devices.deviceId;
  const value = "id" in ref ? ref.id : ref.deviceId;
  const rows = await getDb()
    .select({ id: devices.id, tenantId: devices.tenantId })
    .from(devices)
    .where(eq(column, value))
    .limit(1);
  return rows[0];
}

export async function getCalibration(
  ref: { id: string } | { deviceId: string }
): Promise<CalibrationView | null> {
  const device = await findDevice(ref);
  if (device === undefined) return null;
  const fallback = await getDefaultPair();
  const rows = await getDb()
    .select()
    .from(deviceCalibration)
    .where(eq(deviceCalibration.deviceId, device.id))
    .limit(1);
  const own = rows[0];
  if (own === undefined) {
    return { effective: fallback, source: "default", device: null, default: fallback };
  }
  const pair = { threshold: own.threshold, minFrames: own.minFrames };
  return { effective: pair, source: "device", device: pair, default: fallback };
}

async function audit(
  deviceRowId: string | null,
  pair: CalibrationPair | null,
  previous: CalibrationPair | null,
  actor: string
): Promise<void> {
  await getDb()
    .insert(calibrationAudit)
    .values({
      deviceId: deviceRowId,
      threshold: pair?.threshold ?? null,
      minFrames: pair?.minFrames ?? null,
      previousThreshold: previous?.threshold ?? null,
      previousMinFrames: previous?.minFrames ?? null,
      actor,
    });
}

export async function setDeviceCalibration(
  ref: { id: string } | { deviceId: string },
  pair: CalibrationPair,
  actor: string
): Promise<CalibrationView | null> {
  const device = await findDevice(ref);
  if (device === undefined) return null;
  const previous = await getCalibration(ref);
  await getDb()
    .insert(deviceCalibration)
    .values({
      deviceId: device.id,
      tenantId: device.tenantId,
      threshold: pair.threshold,
      minFrames: pair.minFrames,
      appliedBy: actor,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: deviceCalibration.deviceId,
      set: {
        threshold: pair.threshold,
        minFrames: pair.minFrames,
        appliedBy: actor,
        appliedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  await audit(device.id, pair, previous?.device ?? null, actor);
  return await getCalibration(ref);
}

export async function deleteDeviceCalibration(
  ref: { id: string } | { deviceId: string },
  actor: string
): Promise<CalibrationView | null> {
  const device = await findDevice(ref);
  if (device === undefined) return null;
  const previous = await getCalibration(ref);
  if (previous?.device != null) {
    await getDb()
      .delete(deviceCalibration)
      .where(and(eq(deviceCalibration.deviceId, device.id)));
    await audit(device.id, null, previous.device, actor);
  }
  return await getCalibration(ref);
}

export async function setDefaultPair(pair: CalibrationPair, actor: string): Promise<CalibrationPair> {
  const previous = await getDefaultPair();
  await getDb()
    .insert(calibrationDefault)
    .values({ id: DEFAULT_ID, threshold: pair.threshold, minFrames: pair.minFrames, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: calibrationDefault.id,
      set: { threshold: pair.threshold, minFrames: pair.minFrames, updatedAt: new Date() },
    });
  await audit(null, pair, previous, actor);
  return pair;
}
