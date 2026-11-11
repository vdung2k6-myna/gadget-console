import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { bridgeAuthorized } from "../src/lib/bridge/auth";
import { activationState, resolveDevice, recordTurn } from "../src/lib/bridge/registry";
import { approveClaim, claimDevice, issueClaim, releaseDevice, resetClaimRateLimit } from "../src/lib/claims";
import { ownDevice as own } from "./helpers/own";
import { createRuntime } from "../src/lib/runtimes";
import { agents, claims, devices, firmwareReleases, tenantDomains, tenants, turns } from "../src/lib/db/schema";
import { POST as resolveRoute } from "../src/app/api/bridge/resolve/route";

before(() => requireTestDatabase());
beforeEach(async () => {
  await resetDb();
  resetClaimRateLimit();
});
after(closeDb);

const MAC = "B8:1F:3F:4A:9B:01";

async function account(email: string) {
  const result = await registerAccount(email, "a good password");
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

async function ownedDevice(userId: string, deviceId = MAC) {
  return own(userId, deviceId);
}

async function agentFor(userId: string) {
  const runtime = await createRuntime({
    name: "interview",
    baseUrl: "http://127.0.0.1:4000",
    token: "runtime-token",
    engines: ["engine-a"],
    languages: ["vietnamese"],
  });
  const rows = await getDb()
    .insert(agents)
    .values({
      userId,
      runtimeId: runtime.id,
      name: "assistant",
      systemPrompt: "be helpful",
      language: "vietnamese",
      engine: "engine-a",
    })
    .returning();
  return rows[0]!;
}

describe("the bridge's credential", () => {
  it("accepts the configured token and nothing else", () => {
    const token = process.env.BRIDGE_TOKEN!;
    const request = (header?: string) =>
      new Request("http://console.test/api/bridge/resolve", {
        method: "POST",
        ...(header === undefined ? {} : { headers: { authorization: header } }),
      });

    assert.equal(bridgeAuthorized(request(`Bearer ${token}`)), true);
    assert.equal(bridgeAuthorized(request(undefined)), false);
    assert.equal(bridgeAuthorized(request("Bearer wrong-token-of-same-length")), false);
    assert.equal(bridgeAuthorized(request(token)), false);
  });
});

describe("resolving a device", () => {
  it("answers an unowned gadget with a code and a secret, and no agent", async () => {
    const resolution = await resolveDevice(MAC);
    assert.equal(resolution.kind, "unowned");
    const body = resolution.body as Record<string, unknown>;
    assert.equal(body.owned, false);
    assert.equal(body.deviceId, "b81f3f4a9b01");
    assert.equal(typeof body.secret, "string");
    assert.ok((body.activation as { code: string }).code.length === 6);
    assert.equal("agent" in body, false);
  });

  it("answers an owned gadget with its agent, runtime and secret", async () => {
    const ann = await account("ann@example.com");
    const device = await ownedDevice(ann.id);
    const agent = await agentFor(ann.id);
    await getDb().update(devices).set({ agentId: agent.id }).where(eq(devices.id, device.id));

    const resolution = await resolveDevice(MAC);
    assert.equal(resolution.kind, "owned");
    const body = resolution.body as Record<string, unknown>;
    assert.equal(body.owned, true);
    assert.equal(body.secret, device.secret);

    const resolvedAgent = body.agent as Record<string, unknown>;
    assert.equal(resolvedAgent.systemPrompt, "be helpful");
    assert.deepEqual(resolvedAgent.runtime, {
      baseUrl: "http://127.0.0.1:4000",
      token: "runtime-token",
    });
    assert.deepEqual(body.turns, []);
  });

  it("answers an owned gadget with no agent bound with a null agent", async () => {
    const ann = await account("ann@example.com");
    await ownedDevice(ann.id);
    const resolution = await resolveDevice(MAC);
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");
    assert.equal(resolution.body.agent, null);
  });

  it("returns recorded turns oldest first", async () => {
    const ann = await account("ann@example.com");
    const device = await ownedDevice(ann.id);
    const base = Date.now();
    for (const [index, text] of ["one", "two"].entries()) {
      await getDb().insert(turns).values({
        deviceId: device.id,
        userText: text,
        assistantText: `answer ${text}`,
        language: "vietnamese",
        engine: "engine-a",
        startedAt: new Date(base + index * 1000),
        endedAt: new Date(base + index * 1000 + 500),
      });
    }

    const resolution = await resolveDevice(MAC);
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");
    const history = (resolution.body as Record<string, unknown>).turns as { userText: string }[];
    assert.deepEqual(
      history.map((turn) => turn.userText),
      ["one", "two"]
    );
  });

  it("answers a released gadget as unowned, with a fresh code", async () => {
    const ann = await account("ann@example.com");
    const device = await ownedDevice(ann.id);
    await releaseDevice(ann.id, device.id);

    const resolution = await resolveDevice(MAC);
    assert.equal(resolution.kind, "unowned");
    assert.ok((resolution.body as Record<string, unknown>).activation);
  });

  it("stops issuing codes to one identifier past the rate limit", async () => {
    let limited = false;
    for (let index = 0; index < 12; index += 1) {
      if ((await resolveDevice(MAC)).kind === "rate-limited") limited = true;
    }
    assert.equal(limited, true);
  });
});

describe("activation", () => {
  it("is pending while a code waits or a request does, and owned only once approved", async () => {
    assert.equal(await activationState(MAC), "unknown");

    const issued = await issueClaim(MAC);
    assert.ok(issued);
    assert.equal(await activationState(MAC), "pending", "a code is waiting to be entered");

    const ann = await account("ann@example.com");
    assert.equal((await claimDevice(ann.id, issued.code)).ok, true);
    assert.equal(await activationState(MAC), "pending", "entered, and waiting for an admin");

    const claimRow = (
      await getDb().select({ id: claims.id }).from(claims).where(eq(claims.code, issued.code)).limit(1)
    )[0]!;
    assert.equal(await approveClaim("admin@example.com", claimRow.id), "approved");
    assert.equal(await activationState(MAC), "owned");
  });
});

describe("recording a turn", () => {
  const started = "2026-10-25T00:00:00.000Z";
  const ended = "2026-10-25T00:00:05.000Z";

  it("stores a served turn for an owned device", async () => {
    const ann = await account("ann@example.com");
    await ownedDevice(ann.id);

    const result = await recordTurn({
      deviceId: MAC,
      userText: "xin chào",
      assistantText: "chào bạn",
      language: "vietnamese",
      engine: "engine-a",
      startedAt: started,
      endedAt: ended,
    });
    assert.equal(result.ok, true);
    const rows = await getDb().select().from(turns);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.assistantText, "chào bạn");
  });

  it("refuses a malformed turn", async () => {
    const ann = await account("ann@example.com");
    await ownedDevice(ann.id);
    assert.deepEqual(await recordTurn({ deviceId: MAC }), { ok: false, reason: "invalid" });
  });

  it("refuses a turn for a gadget nobody owns", async () => {
    await issueClaim(MAC);
    const result = await recordTurn({
      deviceId: MAC,
      userText: "xin chào",
      assistantText: "chào bạn",
      language: "vietnamese",
      engine: "engine-a",
      startedAt: started,
      endedAt: ended,
    });
    assert.deepEqual(result, { ok: false, reason: "device-not-found" });
  });
});

describe("the firmware target in a resolution", () => {
  const previousUrl = process.env.CONSOLE_PUBLIC_URL;
  const previousDir = process.env.FIRMWARE_DIR;

  beforeEach(() => {
    process.env.FIRMWARE_DIR = "/tmp/gc-firmware-unused";
    process.env.CONSOLE_PUBLIC_URL = "https://console.example.com";
  });

  after(() => {
    if (previousUrl === undefined) delete process.env.CONSOLE_PUBLIC_URL;
    else process.env.CONSOLE_PUBLIC_URL = previousUrl;
    if (previousDir === undefined) delete process.env.FIRMWARE_DIR;
    else process.env.FIRMWARE_DIR = previousDir;
  });

  const REPORT = { board: { type: "esp-box-3" }, application: { version: "1.2.3" } };

  async function deviceReporting(report?: unknown) {
    const ann = await account("ann@example.com");
    const device = await ownedDevice(ann.id);
    if (report !== undefined) {
      await getDb().update(devices).set({ hardware: report as never }).where(eq(devices.id, device.id));
    }
    return device;
  }

  async function targetedRelease(version = "1.2.4", forced = false) {
    const rows = await getDb()
      .insert(firmwareReleases)
      .values({
        boardType: "esp-box-3",
        version,
        sizeBytes: 16,
        sha256: "a".repeat(64),
        targeted: true,
        forced,
      })
      .returning();
    return rows[0]!;
  }

  function firmwareOf(body: Record<string, unknown>) {
    return body.firmware as Record<string, unknown> | undefined;
  }

  it("carries the target for an owned device running a different version", async () => {
    await deviceReporting(REPORT);
    const release = await targetedRelease();
    const resolution = await resolveDevice(MAC);
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");

    assert.deepEqual(firmwareOf(resolution.body), {
      version: "1.2.4",
      url: `https://console.example.com/firmware/${release.id}`,
      force: false,
    });
  });

  it("carries the force flag only when the release says so", async () => {
    await deviceReporting(REPORT);
    await targetedRelease("1.2.2", true);
    const resolution = await resolveDevice(MAC);
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");
    assert.equal(firmwareOf(resolution.body)?.force, true);
  });

  it("carries nothing when the device already runs the target", async () => {
    await deviceReporting(REPORT);
    await targetedRelease("1.2.3");
    const resolution = await resolveDevice(MAC);
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");
    assert.equal("firmware" in resolution.body, false);
  });

  it("carries nothing when the device reported no board type", async () => {
    await deviceReporting();
    await targetedRelease();
    const resolution = await resolveDevice(MAC);
    if (resolution.kind !== "owned") throw new Error("expected an owned resolution");
    assert.equal("firmware" in resolution.body, false);
  });

  it("carries nothing for a device nobody owns", async () => {
    await targetedRelease();
    const resolution = await resolveDevice(MAC);
    assert.equal(resolution.kind, "unowned");
    assert.equal("firmware" in resolution.body, false);
  });

  it("carries nothing when the deployment has no public base", async () => {
    await deviceReporting(REPORT);
    await targetedRelease();
    delete process.env.CONSOLE_PUBLIC_URL;
    try {
      const resolution = await resolveDevice(MAC);
      if (resolution.kind !== "owned") throw new Error("expected an owned resolution");
      assert.equal("firmware" in resolution.body, false);
    } finally {
      process.env.CONSOLE_PUBLIC_URL = "https://console.example.com";
    }
  });
});

describe("tenant-scoped bridge resolution", () => {
  async function twoTenants() {
    const [first] = await getDb()
      .insert(tenants)
      .values({ name: "First", slug: "first" })
      .returning();
    const [second] = await getDb()
      .insert(tenants)
      .values({ name: "Second", slug: "second" })
      .returning();
    return { first, second };
  }

  it("creates an unknown device in the host's tenant and refuses another tenant", async () => {
    const { first, second } = await twoTenants();

    const resolved = await resolveDevice(MAC, first.id);
    assert.equal(resolved.kind, "unowned");

    const rows = await getDb()
      .select()
      .from(devices)
      .where(eq(devices.deviceId, "b81f3f4a9b01"));
    assert.equal(rows[0]?.tenantId, first.id);

    const wrong = await resolveDevice(MAC, second.id);
    assert.equal(wrong.kind, "wrong-tenant");
  });

  it("serves an owned device only on its tenant", async () => {
    const ann = await account("ann@example.com");
    const device = await ownedDevice(ann.id);
    const { first, second } = await twoTenants();
    await getDb().update(devices).set({ tenantId: first.id }).where(eq(devices.id, device.id));

    const ok = await resolveDevice(MAC, first.id);
    assert.equal(ok.kind, "owned");

    const wrong = await resolveDevice(MAC, second.id);
    assert.equal(wrong.kind, "wrong-tenant");

    assert.equal(await activationState(MAC, first.id), "owned");
    assert.equal(await activationState(MAC, second.id), "unknown");
  });

  it("resolves the tenant from the gateway host at the route", async () => {
    const { first } = await twoTenants();
    await getDb().insert(tenantDomains).values({
      tenantId: first.id,
      domain: "gateway.first.example",
      kind: "gateway",
    });

    const request = new Request("http://gateway.test/api/bridge/resolve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.BRIDGE_TOKEN}`,
        "content-type": "application/json",
        "x-forwarded-host": "gateway.first.example",
      },
      body: JSON.stringify({ deviceId: MAC }),
    });

    const response = await resolveRoute(request);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { owned?: boolean };
    assert.equal(body.owned, false);

    const rows = await getDb()
      .select()
      .from(devices)
      .where(eq(devices.deviceId, "b81f3f4a9b01"));
    assert.equal(rows[0]?.tenantId, first.id);
  });

  it("refuses an owned device on another tenant's gateway host", async () => {
    const { first, second } = await twoTenants();
    const ann = await registerAccount("ann@example.com", "a good password", first.id);
    if (!ann.ok) throw new Error("account failed");
    const device = await own(ann.user.id, MAC);
    await getDb()
      .update(devices)
      .set({ tenantId: first.id })
      .where(eq(devices.id, device.id));
    await getDb().insert(tenantDomains).values({
      tenantId: second.id,
      domain: "gateway.second.example",
      kind: "gateway",
    });

    const request = new Request("http://gateway.second.example/api/bridge/resolve", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.BRIDGE_TOKEN}`,
        "content-type": "application/json",
        "x-forwarded-host": "gateway.second.example",
      },
      body: JSON.stringify({ deviceId: MAC }),
    });

    const response = await resolveRoute(request);
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error?: string };
    assert.match(body.error ?? "", /wrong tenant/i);
  });
});
