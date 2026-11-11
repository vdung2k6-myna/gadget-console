import "dotenv/config";
import { and, eq, like } from "drizzle-orm";
import { closeDb, getDb } from "../src/lib/db/client";
import { agents, devices, runtimes, tenants, users } from "../src/lib/db/schema";
import { newDeviceSecret, normalizeDeviceId } from "../src/lib/claims";
import { ensureRuntime } from "../src/lib/runtimes";

/**
 * Seeds the devices a bridge soak drives, and the agent that answers them.
 *
 *   DATABASE_URL=<console test database> RUNTIME_TOKEN=... \
 *     npm run seed:soak -- --count 100
 *
 * The bridge resolves every device from the console, and a device with no agent
 * is admitted but its turns are not answered. So a soak needs both: N claimed
 * device rows with a secret each, bound to one agent whose runtime is the API
 * under test.
 *
 * It refuses a database whose name does not end in `_test`. These rows are
 * indistinguishable from a person's gadgets once written, and the only safe
 * place to leave a hundred of them is a database that is expected to be thrown
 * away.
 *
 * `--cleanup` removes what this script created, by the same prefix.
 */

const DEFAULT_PREFIX = "aa:50:00:00:00:";
const SOAK_AGENT_NAME = "soak";
const SOAK_DEVICE_NAME = "soak";

function argument(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    throw new Error("DATABASE_URL is not a URL");
  }
}

async function ensureUser(email: string) {
  const existing = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0] !== undefined) return existing[0];

  const inserted = await getDb()
    .insert(users)
    .values({ email, passwordHash: "soak-only-not-a-login" })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (inserted[0] !== undefined) return inserted[0];

  const raced = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (raced[0] === undefined) throw new Error(`could not create the soak account ${email}`);
  return raced[0];
}

async function ensureAgent(userId: string, tenantId: string, runtimeId: string) {
  const existing = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.userId, userId), eq(agents.name, SOAK_AGENT_NAME)))
    .limit(1);
  if (existing[0] !== undefined) {
    // The agent may predate a re-seed with a different runtime; keep it pointing
    // where the deployment is now.
    if (existing[0].runtimeId !== runtimeId) {
      await getDb().update(agents).set({ runtimeId }).where(eq(agents.id, existing[0].id));
    }
    return existing[0];
  }

  const inserted = await getDb()
    .insert(agents)
    .values({
      tenantId,
      userId,
      runtimeId,
      name: SOAK_AGENT_NAME,
      systemPrompt: "Answer in one short sentence.",
      language: "english",
      engine: "piper",
      answerMode: "generate",
      topics: [],
    })
    .returning();
  return inserted[0]!;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (url === "") throw new Error("DATABASE_URL is required");
  const name = databaseName(url);
  if (!name.endsWith("_test")) {
    throw new Error(
      `refusing to seed "${name}": the database name must end in _test; ` +
        "these rows are indistinguishable from a person's gadgets"
    );
  }

  const prefix = argument("prefix", DEFAULT_PREFIX);
  const normalizedPrefix = normalizeDeviceId(prefix);
  const count = Number(argument("count", "0"));

  if (hasFlag("cleanup")) {
    const removed = await getDb()
      .delete(devices)
      .where(
        and(eq(devices.name, SOAK_DEVICE_NAME), like(devices.deviceId, `${normalizedPrefix}%`))
      )
      .returning({ deviceId: devices.deviceId });
    console.log(`removed ${removed.length} soak device(s) under ${prefix}`);
    return;
  }

  if (!Number.isInteger(count) || count < 1) {
    throw new Error("--count must be a positive integer");
  }

  const runtimeToken = (process.env.RUNTIME_TOKEN ?? "").trim();
  if (runtimeToken === "") {
    throw new Error("RUNTIME_TOKEN is required: it is the credential the bridge presents to the runtime");
  }

  const email = `soak-${normalizedPrefix}@example.test`;
  const user = await ensureUser(email);
  const baseUrl = process.env.RUNTIME_URL?.trim() || "http://127.0.0.1:4000";
  const runtime = await ensureRuntime({
    name: process.env.RUNTIME_NAME?.trim() || SOAK_AGENT_NAME,
    baseUrl,
    token: runtimeToken,
    engines: ["piper"],
    languages: ["english", "vietnamese"],
  });
  // Re-seeding is how a soak changes what answers it — the real runtime, or the
  // stub on another port. An existing row named for the soak is moved, not kept
  // pointing where it did on the first run.
  if (runtime.baseUrl !== baseUrl || runtime.token !== runtimeToken) {
    await getDb().update(runtimes).set({ baseUrl, token: runtimeToken }).where(eq(runtimes.id, runtime.id));
  }
  const [tenant] = await getDb()
    .insert(tenants)
    .values({ name: "Soak", slug: "soak" })
    .onConflictDoNothing({ target: tenants.slug })
    .returning();
  const tenantId =
    tenant?.id ??
    (await getDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, "soak"))
      .limit(1))[0]!.id;
  await getDb().update(users).set({ tenantId }).where(eq(users.id, user.id));
  const agent = await ensureAgent(user.id, tenantId, runtime.id);

  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    const raw = `${prefix}${index.toString(16).padStart(2, "0")}`;
    const deviceId = normalizeDeviceId(raw);
    ids.push(raw);
    const inserted = await getDb()
      .insert(devices)
      .values({
        tenantId,
        deviceId,
        userId: user.id,
        agentId: agent.id,
        name: SOAK_DEVICE_NAME,
        secret: newDeviceSecret(),
      })
      .onConflictDoUpdate({
        target: devices.deviceId,
        set: { tenantId, userId: user.id, agentId: agent.id, name: SOAK_DEVICE_NAME },
      })
      .returning({ deviceId: devices.deviceId });
    if (inserted[0] === undefined) throw new Error(`could not seed ${raw}`);
  }

  console.log(`seeded ${ids.length} device(s) under ${prefix}`);
  console.log(`agent     ${agent.name} (${agent.id})`);
  console.log(`runtime   ${runtime.name} at ${baseUrl}`);
  for (const id of ids) console.log(`device    ${id}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
