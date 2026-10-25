import type { Locale } from "@/lib/i18n/locales";
import { enGuide } from "./en";
import type { Guide } from "./types";
import { viGuide } from "./vi";

const GUIDES: Record<Locale, Guide> = { vi: viGuide, en: enGuide };

export function guideFor(locale: Locale): Guide {
  return GUIDES[locale];
}

export type { Block, Guide, Section } from "./types";
