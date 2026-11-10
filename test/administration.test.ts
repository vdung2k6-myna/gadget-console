import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { adminDevice, adminTurns, listAllDevices } from "../src/lib/admin";
import { adminBindAgent, adminPair, adminRelease } from "../src/lib/admin-actions";
import { registerAccount } from "../src/lib/auth/accounts";
import { createAgent, validateAgentDraft } from "../src/lib/agents";
import { createProviderProfile } from "../src/lib/provider-profiles";
import { changeRoleAsAdmin, listAccounts, setRole } from "../src/lib/users";
import { createRuntime } from "../src/lib/runtimes";
import { devices, tenants, turns } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function account(email: string) {
  const result = await registerAccount(email, "a good password");
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

async function tenant(slug: string) {
  const rows = await getDb()
    .insert(tenants)
    .values({ name: slug, slug })
    .returning();
  return rows[0]!;
}

async function tenantAccount(email: string, tenantId: string) {
  const result = await registerAccount(email, "a good password", tenantId);
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

async function device(userId: string | null, deviceId: string) {
  const rows = await getDb()
    .insert(devices)
    .values({ deviceId, userId, secret: "s".repeat(32), name: "" })
    .returning();
  return rows[0]!;
}

async function agentFor(userId: string) {
  const runtime = await createRuntime({
    name: "interview",
    baseUrl: "http://127.0.0.1:4000",
    token: "runtime-token",
    engines: ["engine-a"],
    languages: ["vietnamese"],
  });
  // An agent must name an answering model: nothing fills one in for it.
  const llm = await createProviderProfile(userId, {
    kind: "llm",
    name: "gpt-mini",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    voice: null,
    temperature: null,
  });
  const validation = await validateAgentDraft(
    {
      name: "assistant",
      runtimeId: runtime.id,
      llmProfileId: llm.id,
      sttProfileId: null,
      ttsProfileId: null,
      systemPrompt: "be helpful",
      language: "vietnamese",
      answerMode: "generate",
      topics: [],
    },
    userId
  );
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return createAgent(userId, validation.draft);
}

function captureLog(run: () => Promise<unknown>): Promise<{ result: unknown; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map((arg) => String(arg)).join(" "));
  return run()
    .then((result) => ({ result, lines }))
    .finally(() => {
      console.log = original;
    });
}

describe("granting the role", () => {
  it("sets it, and says what it was", async () => {
    const acme = await tenant("acme");
    const ann = await tenantAccount("ann@example.com", acme.id);
    const result = await setRole(" ANN@Example.com ", "tenant_admin");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.email, "ann@example.com");
    assert.equal(result.previous, "user");
    assert.equal(result.role, "tenant_admin");

    const again = await setRole("ann@example.com", "tenant_admin");
    assert.equal(again.ok && again.previous, "tenant_admin", "setting it twice changes nothing");
    assert.ok(ann.id);
  });

  it("refuses an address nobody holds, and a role that is not one", async () => {
    const acme = await tenant("acme");
    await tenantAccount("ann@example.com", acme.id);
    assert.deepEqual(await setRole("nobody@example.com", "tenant_admin"), {
      ok: false,
      reason: "no-such-account",
    });
    assert.deepEqual(await setRole("ann@example.com", "root"), { ok: false, reason: "unknown-role" });
  });

  it("refuses a tenant role for an account with no tenant", async () => {
    await account("platform@example.com");
    assert.deepEqual(await setRole("platform@example.com", "tenant_admin"), {
      ok: false,
      reason: "no-tenant",
    });
    assert.deepEqual(await setRole("platform@example.com", "platform_admin"), {
      ok: true,
      email: "platform@example.com",
      previous: "user",
      role: "platform_admin",
    });
  });
});

describe("an admin granting the role", () => {
  it("promotes and demotes another account, recording who did it", async () => {
    const acme = await tenant("acme");
    const ann = await tenantAccount("ann@example.com", acme.id);
    await tenantAccount("root@example.com", acme.id);
    await setRole("root@example.com", "tenant_admin");
    const root = { email: "root@example.com", role: "tenant_admin", tenantId: acme.id };

    const promoted = await captureLog(() => changeRoleAsAdmin(root, ann.id, "tenant_admin"));
    assert.deepEqual(promoted.result, { ok: true });
    assert.ok(promoted.lines.some((line) => line.includes("root@example.com") && line.includes("ann@example.com")));

    const accounts = await listAccounts(acme.id);
    assert.equal(accounts.find((entry) => entry.email === "ann@example.com")?.role, "tenant_admin");

    // Now two tenant admins, so one may be demoted.
    assert.deepEqual(await changeRoleAsAdmin(root, ann.id, "user"), { ok: true });
  });

  it("refuses to remove the last tenant admin", async () => {
    const acme = await tenant("acme");
    const ann = await tenantAccount("ann@example.com", acme.id);
    await setRole("ann@example.com", "tenant_admin");
    const admin = { email: "ann@example.com", role: "tenant_admin", tenantId: acme.id };

    assert.deepEqual(await changeRoleAsAdmin(admin, ann.id, "user"), {
      ok: false,
      reason: "last-admin",
    });
    assert.equal(
      (await listAccounts(acme.id)).find((entry) => entry.email === "ann@example.com")?.role,
      "tenant_admin"
    );
  });

  it("refuses a tenant admin reaching another tenant", async () => {
    const acme = await tenant("acme");
    const other = await tenant("other");
    const ann = await tenantAccount("ann@example.com", acme.id);
    const bob = await tenantAccount("bob@example.com", other.id);
    const admin = { email: "ann@example.com", role: "tenant_admin", tenantId: acme.id };

    assert.deepEqual(await changeRoleAsAdmin(admin, bob.id, "tenant_admin"), {
      ok: false,
      reason: "not-found",
    });
    assert.deepEqual(await changeRoleAsAdmin(admin, ann.id, "platform_admin"), {
      ok: false,
      reason: "not-found",
    });
  });

  it("refuses to remove the last platform admin", async () => {
    const acme = await tenant("acme");
    const root = await tenantAccount("root@example.com", acme.id);
    await setRole("root@example.com", "platform_admin");
    const admin = { email: "root@example.com", role: "platform_admin", tenantId: null };

    assert.deepEqual(await changeRoleAsAdmin(admin, root.id, "tenant_admin"), {
      ok: false,
      reason: "last-admin",
    });
  });

  it("refuses to return a protected admin to a user, from the area or the command", async () => {
    // The guard is the deployment's setting, so the test names its own account.
    process.env.PROTECTED_ADMINS = "guardian@example.com";
    try {
      const acme = await tenant("acme");
      await tenantAccount("guardian@example.com", acme.id);
      await setRole("guardian@example.com", "platform_admin");

      const protectedAccount = (await listAccounts()).find((entry) => entry.email === "guardian@example.com")!;
      const admin = { email: "root@example.com", role: "platform_admin", tenantId: null };
      assert.deepEqual(await changeRoleAsAdmin(admin, protectedAccount.id, "user"), {
        ok: false,
        reason: "protected",
      });
      assert.deepEqual(await setRole("guardian@example.com", "user"), { ok: false, reason: "protected" });
      assert.equal(
        (await listAccounts()).find((entry) => entry.email === "guardian@example.com")?.role,
        "platform_admin"
      );
    } finally {
      delete process.env.PROTECTED_ADMINS;
    }
  });

  it("refuses an unknown role and an unknown account", async () => {
    const acme = await tenant("acme");
    const ann = await tenantAccount("ann@example.com", acme.id);
    const admin = { email: "root@example.com", role: "platform_admin", tenantId: null };

    assert.deepEqual(await changeRoleAsAdmin(admin, ann.id, "root"), {
      ok: false,
      reason: "unknown-role",
    });
    assert.deepEqual(
      await changeRoleAsAdmin(admin, "00000000-0000-0000-0000-000000000000", "tenant_admin"),
      { ok: false, reason: "not-found" }
    );
  });
});

describe("what an admin reads", () => {
  it("sees every account's devices, with the owner's address", async () => {
    const ann = await account("ann@example.com");
    const bob = await account("bob@example.com");
    await device(ann.id, "aa0000000001");
    await device(bob.id, "aa0000000002");
    await device(null, "aa0000000003");

    const all = await listAllDevices();
    assert.equal(all.length, 3);
    assert.equal(all.find((entry) => entry.deviceId === "aa0000000001")?.ownerEmail, "ann@example.com");
    assert.equal(all.find((entry) => entry.deviceId === "aa0000000003")?.ownerEmail, "");
  });

  it("opens any device and its conversation", async () => {
    const ann = await account("ann@example.com");
    const one = await device(ann.id, "aa0000000001");
    const now = new Date();
    await getDb().insert(turns).values({
      deviceId: one.id,
      userText: "xin chào",
      assistantText: "chào bạn",
      language: "vietnamese",
      engine: "engine-a",
      startedAt: now,
      endedAt: now,
    });

    assert.equal((await adminDevice(one.id))?.ownerEmail, "ann@example.com");
    assert.equal((await adminTurns(one.id, 10)).length, 1);
  });

  it("shows nothing of an account's model provider", async () => {
    const ann = await account("ann@example.com");
    await device(ann.id, "aa0000000001");
    await createProviderProfile(ann.id, {
      kind: "llm",
      name: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      voice: null,
      temperature: null,
      apiKey: "sk-secret",
    });

    const shown = JSON.stringify(await listAllDevices());
    assert.equal(shown.includes("sk-secret"), false);
    assert.equal(shown.includes("openai"), false);
  });

  it("counts what each account owns", async () => {
    const ann = await account("ann@example.com");
    await account("bob@example.com");
    await device(ann.id, "aa0000000001");
    await device(ann.id, "aa0000000002");

    const accounts = await listAccounts();
    assert.equal(accounts.find((entry) => entry.email === "ann@example.com")?.devices, 2);
    assert.equal(accounts.find((entry) => entry.email === "bob@example.com")?.devices, 0);
    assert.equal(accounts.find((entry) => entry.email === "ann@example.com")?.role, "user");
  });
});

describe("what an admin changes", () => {
  it("binds the owner's agent, and refuses the admin's own", async () => {
    const ann = await account("ann@example.com");
    const admin = await account("root@example.com");
    const bob = await account("bob@example.com");
    const one = await device(ann.id, "aa0000000001");
    const annsAgent = await agentFor(ann.id);
    const bobsAgent = await agentFor(bob.id);

    assert.deepEqual(await adminBindAgent(admin.email, one.id, annsAgent.id), { ok: true });
    assert.deepEqual(await adminBindAgent(admin.email, one.id, bobsAgent.id), {
      ok: false,
      reason: "not-found",
    });

    const rows = await getDb().select().from(devices).where(eq(devices.id, one.id));
    assert.equal(rows[0]?.agentId, annsAgent.id);
  });

  it("releases another account's gadget and records who did it", async () => {
    const ann = await account("ann@example.com");
    const one = await device(ann.id, "aa0000000001");

    const { result, lines } = await captureLog(() => adminRelease("root@example.com", one.id));
    assert.deepEqual(result, { ok: true });

    const rows = await getDb().select().from(devices).where(eq(devices.id, one.id));
    assert.equal(rows[0]?.userId, null, "released: it belongs to nobody again");
    assert.ok(lines.some((line) => line.includes("root@example.com") && line.includes("aa0000000001")));
  });

  it("pairs two of the owner's devices, and refuses a device with no owner", async () => {
    const ann = await account("ann@example.com");
    const one = await device(ann.id, "aa0000000001");
    const two = await device(ann.id, "aa0000000002");
    const orphan = await device(null, "aa0000000003");

    assert.deepEqual(await adminPair("root@example.com", one.id, two.id), { ok: true });
    assert.deepEqual(await adminPair("root@example.com", orphan.id, two.id), {
      ok: false,
      reason: "no-owner",
    });
  });
});
