import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DeviceHardware } from "@/lib/device-hardware";
import type { AgentVoiceConversion } from "@/lib/agent-voice-conversion";

/**
 * The console's data model.
 *
 * Two facts shape it. A device exists before it has an owner: a gadget's first
 * OTA request creates its row, with its own secret, because the firmware
 * connects with the token it was given *before* activation — a secret created at
 * claim time would make that token stale. And a device belongs to at most one
 * account and at most one agent, while an agent may serve several devices.
 */

/**
 * A tenant is a reseller's slice of the deployment: its own users, devices,
 * agents, provider profiles, firmware and records. Platform built-ins are the
 * only rows without a tenant.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** `active`, `suspended` or `deleted`. Checked by the tenant module. */
    status: text("status").notNull().default("active"),
    locale: text("locale").notNull().default("vi"),
    /** Null inherits the deployment's retention. */
    retentionDays: integer("retention_days"),
    /** Platform speech seconds included before overage is billed; null means none. */
    speechAllowanceSeconds: integer("speech_allowance_seconds"),
    plan: text("plan"),
    quotas: jsonb("quotas").$type<Record<string, number>>(),
    branding: jsonb("branding").$type<Record<string, unknown>>(),
    /**
     * How the adapter chain is ordered and filtered: `{localOnly, order}`.
     * The resolver reads it on every session; absent means the tenant's own
     * verified adapters first, then the platform's.
     */
    adapterPolicy: jsonb("adapter_policy").$type<{
      localOnly?: boolean;
      order?: string[];
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("tenants_slug_unique").on(table.slug)]
);

/**
 * A host that resolves to one tenant. A host belongs to one tenant; a tenant
 * has at most one console host and one gateway host.
 */
export const tenantDomains = pgTable(
  "tenant_domains",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Lowercased, without a scheme. */
    domain: text("domain").notNull(),
    /** `console` or `gateway`; checked by the tenant module. */
    kind: text("kind").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("tenant_domains_domain_unique").on(table.domain),
    uniqueIndex("tenant_domains_tenant_kind_unique").on(table.tenantId, table.kind),
    index("tenant_domains_tenant_idx").on(table.tenantId),
  ]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** The tenant this account belongs to; null only for a platform admin. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** `user` or `admin`. Set only by the deployment's command, never by a route. */
    role: text("role").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_tenant_idx").on(table.tenantId),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    /** A hash of the session token; the token itself is never stored. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_expires_idx").on(table.expiresAt)]
);

export const runtimes = pgTable(
  "runtimes",
  {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  /** Never returned to a browser route; only the bridge sees it. */
  token: text("token").notNull(),
  engines: text("engines").array().notNull(),
  languages: text("languages").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("runtimes_tenant_idx").on(table.tenantId)]
);

/**
 * The endpoints that hear, speak and answer for a gadget's agent.
 *
 * One table with a `kind` rather than three: the encryption, ownership and
 * delete-to-default rules are the same for all three, and three tables would
 * triple them for no gain. A profile with no owner is built in — seeded by the
 * deployment, visible to every account, and refused for edit and delete.
 */
export const providerProfiles = pgTable(
  "provider_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Null for a platform built-in; set for a tenant built-in or account profile. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    /** Null for a built-in a deployment or tenant seeded; never owned by an account. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** `llm`, `stt` or `tts`; checked by the profile module, not by the column. */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** The direct shape's endpoint; null when the profile names an adapter. */
    baseUrl: text("base_url"),
    /** Empty for a provider that needs no key, which every local audio service is. */
    encryptedKey: text("encrypted_key").notNull().default(""),
    /** The direct shape's model; null when the profile names an adapter. */
    model: text("model"),
    /**
     * The registered adapter an adapter-backed profile names. Null is the
     * direct shape — the OpenAI-compatible path this table has always held — so
     * every existing row keeps working without a backfill.
     */
    adapterId: uuid("adapter_id").references(() => providerAdapters.id, {
      onDelete: "restrict",
    }),
    /** The opaque configuration the adapter's manifest declares, if any. */
    config: jsonb("config").$type<Record<string, unknown>>(),
    /** The voice a `tts` profile speaks in; null for the other kinds. */
    voice: text("voice"),
    /** The account's own choice of temperature; `llm` only. */
    temperature: doublePrecision("temperature"),
    /** Seeded by the deployment: every account may select it, none may change it. */
    builtin: boolean("builtin").notNull().default(false),
    /**
     * The built-in an account's speech settings are pre-filled from, and what
     * answers a kind the account has not configured. At most one per kind.
     */
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("provider_profiles_user_kind_idx").on(table.userId, table.kind),
    index("provider_profiles_tenant_idx").on(table.tenantId),
  ]
);

/**
 * A reseller-hosted provider adapter, or a platform-owned one that every tenant
 * may select.
 *
 * The chain resolver reads this registry: a row is a candidate only for its own
 * tenant and the platform rows, never another tenant's. `status` gates use
 * (`verified`), `health` gates the current chain, and `privacy.remote` is what a
 * local-only policy excludes. The endpoint, token, manifest and scores are the
 * remote-adapter contract's; the console only stores them.
 */
export const providerAdapters = pgTable(
  "provider_adapters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Null for a platform-owned adapter. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    endpoint: text("endpoint").notNull(),
    /** `llm`, `stt` and/or `tts`; checked by the adapter module. */
    kinds: text("kinds").array().notNull().default([]),
    /** `pending`, `verified` or `disabled`. */
    status: text("status").notNull().default("pending"),
    /** `ok`, `degraded`, `down` or `unknown`. */
    health: text("health").notNull().default("unknown"),
    /** Operator, region, what it receives, retention and whether it is remote. */
    privacy: jsonb("privacy").$type<{
      operator?: string;
      region?: string;
      receives?: string[];
      retentionDays?: number | null;
      remote?: boolean;
    }>(),
    capabilities: jsonb("capabilities").$type<{
      tools?: boolean;
      languages?: string[];
      streaming?: boolean;
    }>(),
    quality: jsonb("quality").$type<{
      wer?: number;
      ttsNaturalness?: number;
      latencyP50Ms?: number;
      score?: number;
    }>(),
    /** The fetched manifest, kept as declared so a version change is visible. */
    manifest: jsonb("manifest").$type<Record<string, unknown>>(),
    /** Conformance and benchmark outcomes; absent until verification runs. */
    verification: jsonb("verification").$type<Record<string, unknown>>(),
    manifestVersion: text("manifest_version"),
    /** The platform-issued adapter token, encrypted under the tenant key. */
    tokenEncrypted: text("token_encrypted").notNull().default(""),
    /** What may be shown: the `adp_` prefix and the last four characters. */
    tokenHint: text("token_hint").notNull().default(""),
    /** The token replaced by rotation, accepted until `previousTokenExpiresAt`. */
    previousTokenEncrypted: text("previous_token_encrypted").notNull().default(""),
    previousTokenHint: text("previous_token_hint").notNull().default(""),
    previousTokenExpiresAt: timestamp("previous_token_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("provider_adapters_tenant_idx").on(table.tenantId),
    index("provider_adapters_status_idx").on(table.status),
  ]
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runtimeId: uuid("runtime_id")
      .notNull()
      .references(() => runtimes.id, { onDelete: "restrict" }),
    /**
     * The account's own model, or null for the runtime's default.
     *
     * A `provider_profiles` row of kind `llm`: the LLM profiles that predate
     * this table are copied into it by the migration, keeping their ids, so an
     * agent that named one names the copy without being rewritten.
     */
    llmProfileId: uuid("llm_profile_id").references(() => providerProfiles.id, {
      onDelete: "set null",
    }),
    /** The transcriber, or null for the runtime's default. */
    sttProfileId: uuid("stt_profile_id").references(() => providerProfiles.id, {
      onDelete: "set null",
    }),
    /** The voice, or null for the runtime's default. */
    ttsProfileId: uuid("tts_profile_id").references(() => providerProfiles.id, {
      onDelete: "set null",
    }),
    /**
     * A voice this agent speaks in, overriding its `tts` profile's, or null to
     * use the profile's. Free text: the endpoint defines what the name means.
     */
    voice: text("voice"),
    name: text("name").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    language: text("language").notNull(),
    /**
     * The engine an agent written before profiles used to name. Null for every
     * agent created since: the engine is now its `tts` profile's model. Kept
     * readable so the history of an older agent is not rewritten.
     */
    engine: text("engine"),
    answerMode: text("answer_mode").notNull().default("generate"),
    topics: text("topics").array().notNull().default([]),
    /**
     * The agent's voice-conversion config. Null inherits the deployment's
     * voice-agent shaping; `{ enabled: false }` opts out of conversion; an object
     * shapes the deployment's active model. Carried to the runtime unchanged.
     */
    ovcConfig: jsonb("ovc_config").$type<AgentVoiceConversion | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agents_user_idx").on(table.userId),
    index("agents_tenant_idx").on(table.tenantId),
  ]
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The `Device-Id` header, normalized. Unique across the console. */
    deviceId: text("device_id").notNull(),
    /** Null while nobody owns the gadget. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull().default(""),
    /** Per-device, so releasing one device revokes only its token. */
    secret: text("secret").notNull(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    partnerDeviceId: uuid("partner_device_id"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    /** The catalogue the gadget reported at its last session: names and the firmware's descriptions. */
    tools: jsonb("tools").$type<{ name: string; description: string }[]>(),
    toolsReportedAt: timestamp("tools_reported_at", { withTimezone: true }),
    /**
     * What the firmware said about its own board at the last OTA, narrowed by
     * `src/lib/device-hardware.ts`. Nullable twice over: a device that has never
     * reported has no value here, and a report that carried no field is refused
     * rather than stored empty.
     */
    hardware: jsonb("hardware").$type<DeviceHardware>(),
    hardwareReportedAt: timestamp("hardware_reported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("devices_device_id_unique").on(table.deviceId),
    index("devices_user_idx").on(table.userId),
    index("devices_tenant_idx").on(table.tenantId),
  ]
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    code: text("code").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** The account that entered the code — the requester, not yet the owner. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** When an admin approved the request; only then does the device change hands. */
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("claims_device_idx").on(table.deviceId),
    index("claims_tenant_idx").on(table.tenantId),
    index("claims_code_idx").on(table.code),
    index("claims_expires_idx").on(table.expiresAt),
  ]
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("conversations_device_idx").on(table.deviceId),
    index("conversations_tenant_idx").on(table.tenantId),
  ]
);

/**
 * A firmware image the console can hand to a gadget.
 *
 * The row is the promise, the file under `FIRMWARE_DIR` is the payload, and the
 * two are linked by the row's id. `targeted` marks the one release a board type
 * should run; the partial unique index makes "one target per board type" a fact of
 * the database rather than a convention a route can forget. `forced` records that
 * an admin deliberately allowed a downgrade — the console itself never orders
 * versions, it leaves that to the firmware.
 */
export const firmwareReleases = pgTable(
  "firmware_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Null for a platform-wide image; set for a tenant's image. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    /** The firmware's own board identity, for example `esp-box-3`. */
    boardType: text("board_type").notNull(),
    /** The version the image itself reports. */
    version: text("version").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    targeted: boolean("targeted").notNull().default(false),
    forced: boolean("forced").notNull().default(false),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("firmware_board_version_unique").on(
      table.tenantId,
      table.boardType,
      table.version
    ),
    uniqueIndex("firmware_board_target_unique")
      .on(table.tenantId, table.boardType)
      .where(sql`${table.targeted}`),
    index("firmware_board_idx").on(table.boardType),
    index("firmware_tenant_idx").on(table.tenantId),
  ]
);

export const turns = pgTable(
  "turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    /** What the runtime transcribed from the person, and what the bridge spoke. */
    userText: text("user_text").notNull(),
    assistantText: text("assistant_text").notNull(),
    language: text("language").notNull(),
    /** The engine a turn before profiles used. Null for every turn since. */
    engine: text("engine"),
    /** The provider profiles that heard, spoke and answered this turn, by name. */
    sttProfile: text("stt_profile"),
    ttsProfile: text("tts_profile"),
    llmProfile: text("llm_profile"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("turns_device_started_idx").on(table.deviceId, table.startedAt),
    index("turns_tenant_idx").on(table.tenantId),
  ]
);

/**
 * One metered event for a tenant: a speech call's seconds, a model's bytes, or a
 * turn. The console records against the tenant, and the usage report reads only
 * its own rows.
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** `speech`, `llm`, `turn` or `device`; checked by the usage module. */
    kind: text("kind").notNull(),
    /** `platform` (metered and billable over the allowance) or `reseller` (recorded, not billed). */
    source: text("source").notNull().default("platform"),
    /** The provider or adapter the usage belongs to, when known. */
    provider: text("provider"),
    /** Audio seconds for speech, zero otherwise. */
    seconds: integer("seconds").notNull().default(0),
    /** Response bytes, zero when not measured. */
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("usage_events_tenant_created_idx").on(table.tenantId, table.createdAt)]
);

/**
 * One platform-observed remote adapter call.
 *
 * It carries what the platform measured — tenant, adapter, kind, region, bytes,
 * latency and status — and nothing that was said: no request text, no audio and
 * no response body.
 */
export const adapterEgressEvents = pgTable(
  "adapter_egress_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    adapterId: uuid("adapter_id").references(() => providerAdapters.id, {
      onDelete: "set null",
    }),
    /** `llm`, `stt` or `tts`. */
    kind: text("kind").notNull(),
    region: text("region"),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    /** Audio the platform observed for an STT/TTS call; zero for LLM. */
    audioSeconds: doublePrecision("audio_seconds").notNull().default(0),
    /** `ok`, `upstream`, `timeout`, `rate_limit`, `refused` or `error`. */
    status: text("status").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("adapter_egress_tenant_at_idx").on(table.tenantId, table.at),
    index("adapter_egress_adapter_idx").on(table.adapterId),
  ]
);

/**
 * A durable, append-only record of an action taken on somebody's data.
 *
 * Support access is the first writer: opening a tenant device's conversation
 * names the actor, the tenant, the device and the time. The module that writes it
 * exports no update or delete, so an application path cannot rewrite history.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Null for a platform-level action that belongs to no tenant. */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** Kept when the account is gone, because the audit names who acted. */
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("audit_events_tenant_at_idx").on(table.tenantId, table.at),
    index("audit_events_target_idx").on(table.targetType, table.targetId),
  ]
);

/**
 * A device's calibration pair, and the deployment default underneath it.
 *
 * A measurement describes a room and a microphone, so it belongs to the device that took it;
 * one bridge can serve several gadgets in different places and every replica resolves the same
 * value from here. The effective pair is the device's when it has one, the default otherwise.
 */
export const deviceCalibration = pgTable("device_calibration", {
  deviceId: uuid("device_id")
    .primaryKey()
    .references(() => devices.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  threshold: doublePrecision("threshold").notNull(),
  minFrames: integer("min_frames").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).defaultNow().notNull(),
  /** `operator:<email>` for an administrator, `session` for the device's own calibration. */
  appliedBy: text("applied_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("device_calibration_tenant_idx").on(table.tenantId)]
);

/** The one row a deployment has: the pair a device without its own entry uses. */
export const calibrationDefault = pgTable("calibration_default", {
  id: text("id").primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  threshold: doublePrecision("threshold").notNull(),
  minFrames: integer("min_frames").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("calibration_default_tenant_idx").on(table.tenantId)]
);

/** One row per change, with the pair that was in effect before it. */
export const calibrationAudit = pgTable(
  "calibration_audit",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
    threshold: doublePrecision("threshold"),
    minFrames: integer("min_frames"),
    previousThreshold: doublePrecision("previous_threshold"),
    previousMinFrames: integer("previous_min_frames"),
    actor: text("actor").notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("calibration_audit_device_idx").on(table.deviceId, table.at),
    index("calibration_audit_tenant_idx").on(table.tenantId),
  ]
);
