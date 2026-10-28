import type { DeviceHardware, HardwareApplication, HardwareDisplay } from "@/lib/device-hardware";
import type { Strings } from "@/lib/i18n/dictionaries/vi";

/**
 * The board section, as data.
 *
 * The page renders label/value pairs, and this decides what those pairs are —
 * pure, so the states can be pinned without a browser test rig. Two rules come
 * from the spec and are visible here: a field the firmware did not send produces
 * no pair at all, and a device with no accepted report is a state of its own
 * rather than an empty list of pairs.
 */

export interface BoardFact {
  key: string;
  label: string;
  value: string;
}

export type BoardView = { kind: "not-reported" } | { kind: "reported"; facts: BoardFact[] };

export function boardView(
  hardware: DeviceHardware | null | undefined,
  strings: Strings
): BoardView {
  if (hardware === null || hardware === undefined) return { kind: "not-reported" };

  const facts: BoardFact[] = [];
  const add = (key: string, label: string, value: string | undefined): void => {
    if (value !== undefined && value !== "") facts.push({ key, label, value });
  };

  add("type", strings.device.boardType, hardware.board?.type);
  add("name", strings.device.boardName, hardware.board?.name);
  add("manufacturer", strings.device.boardManufacturer, hardware.board?.manufacturer);
  add("chip", strings.device.boardChip, hardware.chip);
  add("flash", strings.device.boardFlash, sizeText(hardware.flashSize));
  add("psram", strings.device.boardPsram, sizeText(hardware.psramSize));
  add("display", strings.device.boardDisplay, displayText(hardware.display, strings));
  add("firmware", strings.device.boardFirmware, firmwareText(hardware.application));
  add("language", strings.device.boardLanguage, hardware.language);

  return facts.length === 0 ? { kind: "not-reported" } : { kind: "reported", facts };
}

export interface FirmwareView {
  /** The version the board report carried, or null when it carried none. */
  reported: string | null;
  /** The version targeted for this board type, or null when none is. */
  target: string | null;
  /** Whether a target differs from what the device reported. */
  different: boolean;
}

/**
 * The firmware comparison, kept to what the console knows. It judges equality, not
 * order: the firmware decides whether a version is newer, and a page that guessed
 * would be wrong exactly when an admin forces a downgrade.
 */
export function firmwareView(
  hardware: DeviceHardware | null | undefined,
  targetVersion: string | null | undefined
): FirmwareView {
  const reported = hardware?.application?.version ?? null;
  const target = targetVersion ?? null;
  return {
    reported,
    target,
    different: reported !== null && target !== null && reported !== target,
  };
}

/** A size a person reads: 16 MB rather than 16777216. Zero stays visible — a board really can have none. */
export function sizeText(bytes: number | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

function displayText(
  display: HardwareDisplay | undefined,
  strings: Strings
): string | undefined {
  if (display === undefined) return undefined;
  const parts: string[] = [];
  if (display.width !== undefined && display.height !== undefined) {
    parts.push(`${display.width} × ${display.height}`);
  }
  if (display.monochrome === true) parts.push(strings.device.boardMonochrome);
  if (display.monochrome === false) parts.push(strings.device.boardColour);
  return parts.length === 0 ? undefined : parts.join(", ");
}

function firmwareText(application: HardwareApplication | undefined): string | undefined {
  if (application === undefined) return undefined;
  if (application.name !== undefined && application.version !== undefined) {
    return `${application.name} ${application.version}`;
  }
  return application.version ?? application.name;
}
