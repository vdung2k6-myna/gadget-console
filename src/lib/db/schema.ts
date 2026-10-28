import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DeviceHardware } from "@/lib/device-hardware";

/**
 * The console's data model.
 *
 * Two facts shape it. A device exists before it has an owner: a gadget's first
 * OTA request creates its row, with its own secret, because the firmware
 * connects with the token it was given *before* activation — a secret created at
 * claim time would make that token stale. And a device belongs to at most one
 * account and at most one agent, while an agent may serve several devices.
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** `user` or `admin`. Set only by the deployment's command, never by a route. */
    role: text("role").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)]
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

export const runtimes = pgTable("runtimes", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  /** Never returned to a browser route; only the bridge sees it. */
  token: text("token").notNull(),
  engines: text("engines").array().notNull(),
  languages: text("languages").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * An account's own OpenAI-compatible endpoint. The key is stored encrypted
 * (`src/lib/crypto/secret-box.ts`) and is never returned to a browser: the read
 * shape says whether one is set, and the bridge is the only caller that receives
 * the decrypted value.
 */
export const llmProfiles = pgTable(
  "llm_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    temperature: doublePrecision("temperature"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("llm_profiles_user_idx").on(table.userId)]
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runtimeId: uuid("runtime_id")
      .notNull()
      .references(() => runtimes.id, { onDelete: "restrict" }),
    /** The account's own model, or null for the runtime's default. */
    llmProfileId: uuid("llm_profile_id").references(() => llmProfiles.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    language: text("language").notNull(),
    engine: text("engine").notNull(),
    answerMode: text("answer_mode").notNull().default("generate"),
    topics: text("topics").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("agents_user_idx").on(table.userId)]
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
  ]
);

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    index("claims_code_idx").on(table.code),
    index("claims_expires_idx").on(table.expiresAt),
  ]
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [index("conversations_device_idx").on(table.deviceId)]
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
    uniqueIndex("firmware_board_version_unique").on(table.boardType, table.version),
    uniqueIndex("firmware_board_target_unique").on(table.boardType).where(sql`${table.targeted}`),
    index("firmware_board_idx").on(table.boardType),
  ]
);

export const turns = pgTable(
  "turns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    engine: text("engine").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("turns_device_started_idx").on(table.deviceId, table.startedAt)]
);
