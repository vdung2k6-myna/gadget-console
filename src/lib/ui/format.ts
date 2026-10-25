import type { Strings } from "@/lib/i18n/dictionaries/vi";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The small pieces of presentation a screen needs, kept pure so they can be
 * tested without rendering anything — and, where words are involved, kept free
 * of them: `elapsed` answers *what kind* of time has passed, and the dictionary
 * says it in the language the person chose.
 */

/** A device's name if it has one, and its identifier otherwise. */
export function deviceLabel(device: { name: string; deviceId: string }): string {
  return device.name.trim() === "" ? device.deviceId : device.name.trim();
}

export type Elapsed =
  | { kind: "never" }
  | { kind: "justNow" }
  | { kind: "minutes"; value: number }
  | { kind: "hours"; value: number }
  | { kind: "days"; value: number }
  | { kind: "date"; at: Date };

/**
 * How long ago something happened. Deliberately coarse: the console stores a
 * time, it does not watch the gadget, so a minute-level answer would imply a
 * liveness the data does not have.
 *
 * `now` is required rather than defaulted: a default would read the clock inside
 * a render, which Next refuses during prerender — and would let two rows on one
 * page be measured against two different "now"s.
 */
export function elapsed(lastSeenAt: Date | null | undefined, now: Date): Elapsed {
  if (lastSeenAt === null || lastSeenAt === undefined) return { kind: "never" };

  const minutes = Math.floor((now.getTime() - lastSeenAt.getTime()) / 60_000);
  if (minutes < 1) return { kind: "justNow" };
  if (minutes < 60) return { kind: "minutes", value: minutes };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { kind: "hours", value: hours };

  const days = Math.floor(hours / 24);
  if (days < 30) return { kind: "days", value: days };

  return { kind: "date", at: lastSeenAt };
}

/** A descriptor, in the words of the chosen language. */
export function elapsedText(value: Elapsed, strings: Strings, locale: Locale): string {
  switch (value.kind) {
    case "never":
      return strings.time.never;
    case "justNow":
      return strings.time.justNow;
    case "minutes":
      return phrase(strings.time.minutes, value.value);
    case "hours":
      return phrase(strings.time.hours, value.value);
    case "days":
      return phrase(strings.time.days, value.value);
    case "date":
      return dateText(value.at, locale);
  }
}

/** A turn's time, as a person reads a log: local date and time. */
export function turnTimeText(at: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

/** The number, and the plural an English-shaped dictionary asks for. */
function phrase(template: string, value: number): string {
  return template.replace("{n}", String(value)).replace("{plural}", value === 1 ? "" : "s");
}

function dateText(at: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(at);
}

function intlLocale(locale: Locale): string {
  return locale === "vi" ? "vi-VN" : "en-GB";
}

/**
 * What the claim route's status means, as a key into the dictionary. The page
 * decides the words; this only decides which of the three refusals it was.
 */
export function claimErrorKey(status: number): "claimUnknown" | "claimExpired" | "claimTaken" | null {
  switch (status) {
    case 404:
      return "claimUnknown";
    case 410:
      return "claimExpired";
    case 409:
      return "claimTaken";
    default:
      return null;
  }
}
