import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { adminDevice, adminTurns, listAllDevices } from "../src/lib/admin";
import { adminBindAgent, adminPair, adminRelease } from "../src/lib/admin-actions";
import { registerAccount } from "../src/lib/auth/accounts";
import { createAgent, validateAgentDraft } from "../src/lib/agents";
import { createProfile, validateProfileDraft } from "../src/lib/llm-profiles";
import { changeRoleAsAdmin, listAccounts, setRole } from "../src/lib/users";
import { createRuntime } from "../src/lib/runtimes";
import { devices, turns } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function account(email: string) {
  const result = await registerAccount(email, "a good password");
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
    engines: ["kokoro"],
    languages: ["vietnamese"],
  });
  const validation = await validateAgentDraft(
    {
      name: "assistant",
      runtimeId: runtime.id,
      systemPrompt: "be helpful",
      language: "vietnamese",
      engine: "kokoro",
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
    const ann = await account("ann@example.com");
    const result = await setRole(" ANN@Example.com ", "admin");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.email, "ann@example.com");
    assert.equal(result.previous, "user");
    assert.equal(result.role, "admin");

    const again = await setRole("ann@example.com", "admin");
    assert.equal(again.ok && again.previous, "admin", "setting it twice changes nothing");
    assert.ok(ann.id);
  });

  it("refuses an address nobody holds, and a role that is not one", async () => {
    assert.deepEqual(await setRole("nobody@example.com", "admin"), {
      ok: false,
      reason: "no-such-account",
    });
    await account("ann@example.com");
    assert.deepEqual(await setRole("ann@example.com", "root"), { ok: false, reason: "unknown-role" });
  });
});

describe("an admin granting the role", () => {
  it("promotes and demotes another account, recording who did it", async () => {
    const ann = await account("ann@example.com");
    const root = await account("root@example.com");
    await setRole("root@example.com", "admin");

    const promoted = await captureLog(() => changeRoleAsAdmin(root.email, ann.id, "admin"));
    assert.deepEqual(promoted.result, { ok: true });
    assert.ok(promoted.lines.some((line) => line.includes("root@example.com") && line.includes("ann@example.com")));

    const accounts = await listAccounts();
    assert.equal(accounts.find((entry) => entry.email === "ann@example.com")?.role, "admin");

    // Now two admins, so one may be demoted.
    assert.deepEqual(await changeRoleAsAdmin(root.email, ann.id, "user"), { ok: true });
  });

  it("refuses to remove the last admin", async () => {
    const ann = await account("ann@example.com");
    await setRole("ann@example.com", "admin");

    assert.deepEqual(await changeRoleAsAdmin("ann@example.com", ann.id, "user"), {
      ok: false,
      reason: "last-admin",
    });
    assert.equal((await listAccounts()).find((entry) => entry.email === "ann@example.com")?.role, "admin");
  });

  it("refuses to return a protected admin to a user, from the area or the command", async () => {
    // The guard is the deployment's setting, so the test names its own account.
    process.env.PROTECTED_ADMINS = "guardian@example.com";
    try {
      await account("guardian@example.com");
      await setRole("guardian@example.com", "admin");

      const protectedAccount = (await listAccounts()).find((entry) => entry.email === "guardian@example.com")!;
      assert.deepEqual(await changeRoleAsAdmin("root@example.com", protectedAccount.id, "user"), {
        ok: false,
        reason: "protected",
      });
      assert.deepEqual(await setRole("guardian@example.com", "user"), { ok: false, reason: "protected" });
      assert.equal((await listAccounts()).find((entry) => entry.email === "guardian@example.com")?.role, "admin");
    } finally {
      delete process.env.PROTECTED_ADMINS;
    }
  });

  it("refuses an unknown role and an unknown account", async () => {
    const ann = await account("ann@example.com");
    assert.deepEqual(await changeRoleAsAdmin("root@example.com", ann.id, "root"), {
      ok: false,
      reason: "unknown-role",
    });
    assert.deepEqual(
      await changeRoleAsAdmin("root@example.com", "00000000-0000-0000-0000-000000000000", "admin"),
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
      engine: "kokoro",
      startedAt: now,
      endedAt: now,
    });

    assert.equal((await adminDevice(one.id))?.ownerEmail, "ann@example.com");
    assert.equal((await adminTurns(one.id, 10)).length, 1);
  });

  it("shows nothing of an account's LLM profile", async () => {
    const ann = await account("ann@example.com");
    await device(ann.id, "aa0000000001");
    const validation = validateProfileDraft(
      { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "m", apiKey: "sk-secret", temperature: null },
      { requireKey: true }
    );
    if (!validation.ok) throw new Error("draft should be valid");
    await createProfile(ann.id, validation.draft);

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
