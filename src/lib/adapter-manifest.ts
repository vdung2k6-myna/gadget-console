import { ADAPTER_KINDS, type AdapterKind } from "@/lib/adapters";

/**
 * The adapter manifest, as contract v1 defines it.
 *
 * `validateAdapterManifest` is pure and names the first thing that is wrong, so a
 * reseller can fix it without reading a stack trace. Additive fields are allowed;
 * the fixed surface is the contract version, identity, kinds, capabilities,
 * config schema, privacy and limits.
 */

export const ADAPTER_CONTRACT = 1;

export type ManifestRefusal =
  | "not-object"
  | "unsupported-contract"
  | "missing-id"
  | "missing-version"
  | "invalid-kinds"
  | "invalid-capabilities"
  | "invalid-config-schema"
  | "invalid-privacy"
  | "invalid-limits"
  | "invalid-usage"
  | "http-error"
  | "invalid-json"
  | "timeout"
  | "unreachable";

export interface AdapterManifest {
  contract: 1;
  id: string;
  version: string;
  displayName?: string;
  kinds: AdapterKind[];
  capabilities: Record<string, Record<string, unknown>>;
  configSchema?: Record<string, unknown>;
  privacy: {
    operator?: string;
    region?: string;
    receives: string[];
    retention?: string | null;
  };
  usage?: string[];
  limits?: Record<string, number>;
}

export type ManifestValidation =
  | { ok: true; manifest: AdapterManifest }
  | { ok: false; reason: ManifestRefusal; detail?: string };

export type ManifestFetchResult =
  | { ok: true; manifest: AdapterManifest }
  | {
      ok: false;
      reason: ManifestRefusal;
      status?: number;
      detail?: string;
    };

const RECEIVES = ["text", "audio"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateAdapterManifest(input: unknown): ManifestValidation {
  if (!isRecord(input)) return { ok: false, reason: "not-object" };

  if (input.contract !== ADAPTER_CONTRACT) {
    return {
      ok: false,
      reason: "unsupported-contract",
      detail: `contract must be ${ADAPTER_CONTRACT}`,
    };
  }

  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (id === "") return { ok: false, reason: "missing-id" };
  const version = typeof input.version === "string" ? input.version.trim() : "";
  if (version === "") return { ok: false, reason: "missing-version" };

  const kinds = Array.isArray(input.kinds)
    ? input.kinds.filter(
        (kind): kind is AdapterKind =>
          typeof kind === "string" && (ADAPTER_KINDS as readonly string[]).includes(kind)
      )
    : [];
  if (kinds.length === 0 || kinds.length !== (input.kinds as unknown[]).length) {
    return { ok: false, reason: "invalid-kinds" };
  }

  if (!isRecord(input.capabilities)) {
    return { ok: false, reason: "invalid-capabilities" };
  }
  const capabilities: Record<string, Record<string, unknown>> = {};
  for (const kind of kinds) {
    const entry = input.capabilities[kind];
    if (!isRecord(entry)) {
      return {
        ok: false,
        reason: "invalid-capabilities",
        detail: `capabilities.${kind} is required`,
      };
    }
    if (entry.languages !== undefined) {
      if (
        !Array.isArray(entry.languages) ||
        !entry.languages.every((language) => typeof language === "string")
      ) {
        return { ok: false, reason: "invalid-capabilities", detail: `${kind}.languages` };
      }
    }
    for (const flag of ["streaming", "tools", "vision", "jsonMode", "metadataPassthrough"] as const) {
      if (entry[flag] !== undefined && typeof entry[flag] !== "boolean") {
        return { ok: false, reason: "invalid-capabilities", detail: `${kind}.${flag}` };
      }
    }
    capabilities[kind] = entry;
  }

  if (input.configSchema !== undefined && !isRecord(input.configSchema)) {
    return { ok: false, reason: "invalid-config-schema" };
  }

  if (!isRecord(input.privacy)) return { ok: false, reason: "invalid-privacy" };
  const receives = input.privacy.receives;
  if (
    !Array.isArray(receives) ||
    receives.length === 0 ||
    !receives.every((entry) => typeof entry === "string" && RECEIVES.includes(entry))
  ) {
    return { ok: false, reason: "invalid-privacy", detail: "privacy.receives" };
  }
  if (input.privacy.operator !== undefined && typeof input.privacy.operator !== "string") {
    return { ok: false, reason: "invalid-privacy", detail: "privacy.operator" };
  }
  if (input.privacy.region !== undefined && typeof input.privacy.region !== "string") {
    return { ok: false, reason: "invalid-privacy", detail: "privacy.region" };
  }
  if (
    input.privacy.retention !== undefined &&
    input.privacy.retention !== null &&
    typeof input.privacy.retention !== "string"
  ) {
    return { ok: false, reason: "invalid-privacy", detail: "privacy.retention" };
  }

  if (input.usage !== undefined) {
    if (!Array.isArray(input.usage) || !input.usage.every((entry) => typeof entry === "string")) {
      return { ok: false, reason: "invalid-usage" };
    }
  }

  const limits: Record<string, number> = {};
  if (input.limits !== undefined) {
    if (!isRecord(input.limits)) return { ok: false, reason: "invalid-limits" };
    for (const [key, value] of Object.entries(input.limits)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return { ok: false, reason: "invalid-limits", detail: `limits.${key}` };
      }
      limits[key] = value;
    }
  }

  return {
    ok: true,
    manifest: {
      contract: ADAPTER_CONTRACT,
      id,
      version,
      ...(typeof input.displayName === "string" ? { displayName: input.displayName } : {}),
      kinds,
      capabilities,
      ...(input.configSchema === undefined
        ? {}
        : { configSchema: input.configSchema }),
      privacy: {
        ...(typeof input.privacy.operator === "string"
          ? { operator: input.privacy.operator }
          : {}),
        ...(typeof input.privacy.region === "string" ? { region: input.privacy.region } : {}),
        receives: receives as string[],
        ...(input.privacy.retention === undefined
          ? {}
          : { retention: input.privacy.retention as string | null }),
      },
      ...(input.usage === undefined ? {} : { usage: input.usage as string[] }),
      ...(input.limits === undefined ? {} : { limits }),
    },
  };
}

function manifestUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/manifest` : `${base}/v1/manifest`;
}

/** Fetch `/v1/manifest`, refusing an unsupported contract or a malformed body. */
export async function fetchAdapterManifest(
  endpoint: string,
  options: { token?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<ManifestFetchResult> {
  const request = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await request(manifestUrl(endpoint), {
      method: "GET",
      redirect: "error",
      headers: {
        accept: "application/json",
        "x-contract-version": String(ADAPTER_CONTRACT),
        ...(options.token === undefined || options.token === ""
          ? {}
          : { authorization: `Bearer ${options.token}` }),
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unreachable";
    return { ok: false, reason };
  }

  if (response.status !== 200) {
    return { ok: false, reason: "http-error", status: response.status };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  return validateAdapterManifest(body);
}
