/**
 * An agent's voice-conversion config, as the console stores it.
 *
 * The column is tri-state: `null` inherits the deployment's voice-agent shaping,
 * `{ enabled: false }` opts out of conversion entirely, and an object shapes the
 * deployment's active model. The bridge carries this value unchanged; the runtime
 * is the authoritative boundary and re-validates it.
 *
 * Validation here refuses a value outside the conversion service's ranges rather
 * than clamping it: a saved value the service would clip is a setting the operator
 * did not get, and naming the field is what makes it fixable.
 */

/** The offline methods the pinned conversion service accepts. */
export const OFFLINE_F0_METHODS = [
  "pm",
  "harvest",
  "dio",
  "crepe",
  "crepe-tiny",
  "mangio-crepe",
  "mangio-crepe-tiny",
  "rmvpe",
  "fcpe",
  "hybrid[crepe+rmvpe]",
  "hybrid[crepe+fcpe]",
  "hybrid[rmvpe+fcpe]",
  "hybrid[crepe+rmvpe+fcpe]",
] as const;

/** The post-conversion effects the service applies, in its own order. */
export const OVC_EFFECT_KEYS = [
  "gate",
  "robot",
  "whisper",
  "distortion",
  "bitcrush",
  "telephone",
  "chorus",
  "echo",
  "reverb",
  "eq",
  "compressor",
  "gain",
] as const;

export interface AgentVoiceConversion {
  enabled?: boolean;
  pitchShift?: number;
  formantShift?: number;
  f0Method?: string;
  indexRate?: number;
  protect?: number;
  rmsMixRate?: number;
  filterRadius?: number;
  crepeHopLength?: number;
  effects?: Record<string, Record<string, unknown>>;
}

export type VoiceConversionValidation =
  | { ok: true; value: AgentVoiceConversion | null }
  | { ok: false; errors: string[] };

function numberIn(
  source: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  errors: string[],
  integer = false
): number | undefined {
  const raw = source[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    errors.push(`voice conversion ${key} must be a number`);
    return undefined;
  }
  if (raw < min || raw > max) {
    errors.push(`voice conversion ${key} must be between ${min} and ${max}`);
    return undefined;
  }
  if (integer && !Number.isInteger(raw)) {
    errors.push(`voice conversion ${key} must be a whole number`);
    return undefined;
  }
  return raw;
}

/**
 * Validate a submitted config.
 *
 * `null` (or absent) means inherit. `{ enabled: false }` means off. Anything else
 * is a custom config, and every named field is checked against the service's
 * bounds; unnamed fields inherit at the runtime.
 */
export function validateAgentVoiceConversion(input: unknown): VoiceConversionValidation {
  if (input === undefined || input === null) return { ok: true, value: null };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["voice conversion must be an object or null"] };
  }

  const source = input as Record<string, unknown>;
  if (source.enabled === false) return { ok: true, value: { enabled: false } };
  if ("enabled" in source && source.enabled !== true) {
    return { ok: false, errors: ["voice conversion enabled must be true or false"] };
  }

  const errors: string[] = [];
  const value: AgentVoiceConversion = {};

  const pitchShift = numberIn(source, "pitchShift", -24, 24, errors);
  if (pitchShift !== undefined) value.pitchShift = pitchShift;
  const formantShift = numberIn(source, "formantShift", -24, 24, errors);
  if (formantShift !== undefined) value.formantShift = formantShift;

  if (source.f0Method !== undefined) {
    const method = typeof source.f0Method === "string" ? source.f0Method.trim().toLowerCase() : "";
    if (!(OFFLINE_F0_METHODS as readonly string[]).includes(method)) {
      errors.push(`voice conversion f0Method ${JSON.stringify(source.f0Method)} is not one the conversion service offers`);
    } else {
      value.f0Method = method;
    }
  }

  const indexRate = numberIn(source, "indexRate", 0, 1, errors);
  if (indexRate !== undefined) value.indexRate = indexRate;
  const protect = numberIn(source, "protect", 0, 0.5, errors);
  if (protect !== undefined) value.protect = protect;
  const rmsMixRate = numberIn(source, "rmsMixRate", 0, 1, errors);
  if (rmsMixRate !== undefined) value.rmsMixRate = rmsMixRate;
  const filterRadius = numberIn(source, "filterRadius", 0, 20, errors, true);
  if (filterRadius !== undefined) value.filterRadius = filterRadius;
  const crepeHopLength = numberIn(source, "crepeHopLength", 64, 512, errors, true);
  if (crepeHopLength !== undefined) value.crepeHopLength = crepeHopLength;

  if (source.effects !== undefined) {
    if (
      typeof source.effects !== "object" ||
      source.effects === null ||
      Array.isArray(source.effects)
    ) {
      errors.push("voice conversion effects must be an object");
    } else {
      const effects: Record<string, Record<string, unknown>> = {};
      for (const key of Object.keys(source.effects as Record<string, unknown>)) {
        const entry = (source.effects as Record<string, unknown>)[key];
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          errors.push(`voice conversion effect ${JSON.stringify(key)} must be an object`);
          continue;
        }
        effects[key] = entry as Record<string, unknown>;
      }
      value.effects = effects;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}
