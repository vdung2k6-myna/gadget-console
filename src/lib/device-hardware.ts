import { eq } from "drizzle-orm";
import { normalizeDeviceId } from "@/lib/claims";
import { getDb } from "@/lib/db/client";
import { devices } from "@/lib/db/schema";

/**
 * What the firmware says about the board it runs on.
 *
 * The firmware posts a full system-info body to the OTA endpoint on every
 * connection (`GetSystemInfoJson` in `main/boards/common/board.cc`). The bridge
 * reads it, drops everything this console has no use for, and forwards what is
 * left. This module is the second half of that filter: the console's own bounds,
 * and the projection a browser is allowed to see.
 *
 * Three rules shape it.
 *
 * **A fact shown is a fact the firmware sent.** Nothing here fills a field from a
 * board-type catalogue or a default, so a board that reported no PSRAM and a
 * board the console believes has none are different things. The bridge already
 * narrowed the body; this file narrows it again, because a future bridge must not
 * be trusted to have the bounds right.
 *
 * **A report is refused whole or taken whole.** A body over a bound, carrying an
 * unknown field, or holding a value of the wrong shape is not partially stored:
 * the previous report stands, exactly as `device-tools.ts` treats a catalogue.
 * Half a board is worse than the last whole one.
 *
 * **Some things are never carried at all.** The partition table, the ELF hash,
 * the MAC address, the device UUID, and cellular identifiers are dropped at the
 * bridge and again here, so no log, proxy or browser response can hold them.
 * The console shows a device's device-id, which is the only identifier a page
 * needs.
 */

export interface HardwareBoard {
  type?: string;
  name?: string;
  manufacturer?: string;
}

export interface HardwareDisplay {
  width?: number;
  height?: number;
  monochrome?: boolean;
}

export interface HardwareApplication {
  name?: string;
  version?: string;
}

/** The whole of what the console keeps. Every field is optional: absent means the firmware did not send it. */
export interface DeviceHardware {
  board?: HardwareBoard;
  chip?: string;
  flashSize?: number;
  psramSize?: number;
  display?: HardwareDisplay;
  application?: HardwareApplication;
  language?: string;
}

export const HARDWARE_LIMITS = {
  /** The console's bound on the forwarded report, well above a real one. */
  maxReportBytes: 16 * 1024,
  /** Board names and version strings are short; anything longer is not the firmware. */
  maxString: 200,
  /** A display, in pixels. */
  maxPixels: 10_000,
  /** Flash and PSRAM, in bytes: 1 TiB is beyond any board this console serves. */
  maxBytes: 2 ** 40,
  /** The allowlist is fixed; a seventeenth key means the sender is not the firmware. */
  maxKeys: 16,
} as const;

const TOP_LEVEL = new Set([
  "board",
  "chip",
  "flashSize",
  "psramSize",
  "display",
  "application",
  "language",
]);
const BOARD_KEYS = new Set(["type", "name", "manufacturer"]);
const DISPLAY_KEYS = new Set(["width", "height", "monochrome"]);
const APPLICATION_KEYS = new Set(["name", "version"]);

export type HardwareValidation =
  | { ok: true; hardware: DeviceHardware }
  | { ok: false; errors: string[] };

/**
 * Reads one forwarded report. Returns the narrowed hardware, or every reason it
 * was refused — a refusal carries no partial object, so a caller cannot store
 * half a board by mistake.
 */
export function validateHardwareReport(input: unknown): HardwareValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["a hardware report must be an object"] };
  }

  const body = input as Record<string, unknown>;
  const errors: string[] = [];

  const keys = Object.keys(body);
  if (keys.length > HARDWARE_LIMITS.maxKeys) {
    errors.push(`a report has at most ${HARDWARE_LIMITS.maxKeys} fields, got ${keys.length}`);
  }
  for (const key of keys) {
    if (!TOP_LEVEL.has(key)) errors.push(`${key} is not a hardware field`);
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(body);
  } catch {
    return { ok: false, errors: ["the report cannot be written as JSON"] };
  }
  if (Buffer.byteLength(serialized, "utf8") > HARDWARE_LIMITS.maxReportBytes) {
    return {
      ok: false,
      errors: [`the report is larger than ${HARDWARE_LIMITS.maxReportBytes} bytes`],
    };
  }

  const hardware: DeviceHardware = {};

  const board = readObject(body.board, "board", BOARD_KEYS, errors);
  if (board !== undefined) {
    const narrowed: HardwareBoard = {
      type: text(board.type, "board.type", errors),
      name: text(board.name, "board.name", errors),
      manufacturer: text(board.manufacturer, "board.manufacturer", errors),
    };
    const kept = defined(narrowed);
    if (Object.keys(kept).length > 0) hardware.board = kept;
  }

  const display = readObject(body.display, "display", DISPLAY_KEYS, errors);
  if (display !== undefined) {
    const narrowed: HardwareDisplay = {
      width: integer(display.width, "display.width", 1, HARDWARE_LIMITS.maxPixels, errors),
      height: integer(display.height, "display.height", 1, HARDWARE_LIMITS.maxPixels, errors),
      monochrome: boolean(display.monochrome, "display.monochrome", errors),
    };
    const kept = defined(narrowed);
    if (Object.keys(kept).length > 0) hardware.display = kept;
  }

  const application = readObject(body.application, "application", APPLICATION_KEYS, errors);
  if (application !== undefined) {
    const narrowed: HardwareApplication = {
      name: text(application.name, "application.name", errors),
      version: text(application.version, "application.version", errors),
    };
    const kept = defined(narrowed);
    if (Object.keys(kept).length > 0) hardware.application = kept;
  }

  const chip = text(body.chip, "chip", errors);
  if (chip !== undefined) hardware.chip = chip;
  const language = text(body.language, "language", errors);
  if (language !== undefined) hardware.language = language;
  const flashSize = integer(body.flashSize, "flashSize", 0, HARDWARE_LIMITS.maxBytes, errors);
  if (flashSize !== undefined) hardware.flashSize = flashSize;
  const psramSize = integer(body.psramSize, "psramSize", 0, HARDWARE_LIMITS.maxBytes, errors);
  if (psramSize !== undefined) hardware.psramSize = psramSize;

  if (errors.length > 0) return { ok: false, errors };
  if (Object.keys(hardware).length === 0) {
    return { ok: false, errors: ["a report must carry at least one hardware fact"] };
  }
  return { ok: true, hardware };
}

/**
 * The report as a browser may see it: the same allowlist, applied again on the
 * way out. Storing a filtered object is not enough on its own — a later change
 * could add a field to the stored shape, and this projection is what stops it
 * reaching a page by accident.
 *
 * A stored value that no longer passes the boundary is read as no report, which
 * is the safe answer: a page would rather say nothing than show a field the
 * console cannot vouch for.
 */
export function publicHardware(raw: unknown): DeviceHardware | null {
  if (raw === null || raw === undefined) return null;
  const validation = validateHardwareReport(raw);
  return validation.ok ? validation.hardware : null;
}

/** Records a report for a device the bridge knows, and says whether it knew it. */
export async function recordDeviceHardware(
  rawDeviceId: string,
  hardware: DeviceHardware
): Promise<boolean> {
  const rows = await getDb()
    .update(devices)
    .set({ hardware, hardwareReportedAt: new Date() })
    .where(eq(devices.deviceId, normalizeDeviceId(rawDeviceId)))
    .returning({ id: devices.id });
  return rows.length > 0;
}

function readObject(
  value: unknown,
  path: string,
  allowed: Set<string>,
  errors: string[]
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is not a hardware field`);
  }
  return record;
}

function text(value: unknown, path: string, errors: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    errors.push(`${path} must be a string`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    errors.push(`${path} is empty`);
    return undefined;
  }
  if (trimmed.length > HARDWARE_LIMITS.maxString) {
    errors.push(`${path} is longer than ${HARDWARE_LIMITS.maxString} characters`);
    return undefined;
  }
  return trimmed;
}

function integer(
  value: unknown,
  path: string,
  min: number,
  max: number,
  errors: string[]
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    errors.push(`${path} must be a whole number between ${min} and ${max}`);
    return undefined;
  }
  return value;
}

function boolean(value: unknown, path: string, errors: string[]): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    errors.push(`${path} must be true or false`);
    return undefined;
  }
  return value;
}

/** Drops the keys a report did not send, so `{}` never reaches storage. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
