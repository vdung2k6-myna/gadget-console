import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { auditEvents, providerAdapters, tenants } from "../src/lib/db/schema";
import {
  readAdapterPolicy,
  resolveAdapterChain,
  saveAdapterPolicy,
  validateAdapterPolicy,
} from "../src/lib/tenancy/adapters";
import {
  listAllEgress,
  listTenantEgress,
  recordAdapterEgress,
} from "../src/lib/adapter-egress";
import { checkAdapterHealth, sweepAdapterHealth } from "../src/lib/adapter-health";
import { runVietnameseBenchmark } from "../src/lib/adapter-benchmark";
import { decryptSecret } from "../src/lib/crypto/secret-box";
import { encryptionKeyForTenant } from "../src/lib/crypto/profiles";
import {
  createAdapter,
  disableAdapter,
  getAdapter,
  listAdapters,
  applyAdapterManifest,
  rotateAdapterToken,
  updateAdapterStatus,
  validateAdapterRegistration,
  verifyAdapterToken,
} from "../src/lib/adapters";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function tenant(slug: string) {
  const rows = await getDb()
    .insert(tenants)
    .values({ name: slug, slug })
    .returning();
  return rows[0]!;
}

async function adapter(input: {
  tenantId: string | null;
  name: string;
  kinds: string[];
  status?: string;
  health?: string;
  remote?: boolean;
  score?: number;
  latency?: number;
  capabilities?: Record<string, unknown>;
}) {
  const rows = await getDb()
    .insert(providerAdapters)
    .values({
      tenantId: input.tenantId,
      name: input.name,
      endpoint: `https://${input.name}.example/v1`,
      kinds: input.kinds,
      status: input.status ?? "verified",
      health: input.health ?? "ok",
      privacy: { remote: input.remote ?? true, region: "sg" },
      capabilities: input.capabilities ?? null,
      quality:
        input.score === undefined && input.latency === undefined
          ? null
          : { score: input.score, latencyP50Ms: input.latency },
    })
    .returning();
  return rows[0]!;
}

describe("the adapter registry", () => {
  it("stores and reads one record with its manifest and verification", async () => {
    const first = await tenant("first");
    const [row] = await getDb()
      .insert(providerAdapters)
      .values({
        tenantId: first.id,
        name: "registry",
        endpoint: "https://adapter.example/v1",
        kinds: ["llm", "stt"],
        status: "pending",
        health: "unknown",
        privacy: { operator: "Reseller", region: "sg", receives: ["text"], remote: true },
        capabilities: { tools: true, languages: ["vi"], streaming: true },
        quality: { wer: 0.1, score: 0.9 },
        manifest: { contract: 1, kinds: ["llm", "stt"] },
        verification: { conformance: "pass", benchmark: "pass" },
        manifestVersion: "1.0.0",
        tokenEncrypted: "cipher",
      })
      .returning();

    const [read] = await getDb()
      .select()
      .from(providerAdapters)
      .where(eq(providerAdapters.id, row!.id));
    assert.equal(read?.manifestVersion, "1.0.0");
    assert.deepEqual(read?.manifest, { contract: 1, kinds: ["llm", "stt"] });
    assert.deepEqual(read?.verification, { conformance: "pass", benchmark: "pass" });
    assert.equal(read?.privacy?.region, "sg");
  });
});

describe("adapter registry accessors", () => {
  it("keeps one tenant's adapter away from another", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const validated = validateAdapterRegistration({
      name: "Reseller adapter",
      endpoint: "https://adapter.example/v1",
      kinds: ["llm"],
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const created = await createAdapter(first.id, validated.draft);
    const adapter = created.adapter;
    assert.equal(adapter.status, "pending");
    assert.match(created.token, /^adp_[A-Za-z0-9_-]+$/);
    assert.equal(adapter.tokenHint, `adp_…${created.token.slice(-4)}`);
    assert.equal("tokenEncrypted" in adapter, false);

    const [stored] = await getDb()
      .select()
      .from(providerAdapters)
      .where(eq(providerAdapters.id, adapter.id));
    assert.notEqual(stored?.tokenEncrypted, created.token);
    assert.equal(
      decryptSecret(stored!.tokenEncrypted, encryptionKeyForTenant(first.id)),
      created.token
    );

    const listed = await listAdapters(first.id);
    assert.deepEqual(listed.map((row) => row.id), [adapter.id]);
    assert.equal("tokenEncrypted" in listed[0]!, false);
    const audit = await getDb().select().from(auditEvents);
    assert.ok(!JSON.stringify(audit).includes(created.token), "no audit row carries the token");
    assert.deepEqual(await listAdapters(second.id), []);
    assert.equal(await getAdapter(second.id, adapter.id), undefined);
    assert.equal(await updateAdapterStatus(second.id, adapter.id, "verified"), undefined);

    assert.equal((await updateAdapterStatus(first.id, adapter.id, "verified"))?.status, "verified");
    assert.equal((await disableAdapter(first.id, adapter.id))?.status, "disabled");
  });

  it("rotates with an overlap and revokes the current token on disable", async () => {
    const first = await tenant("first");
    const validated = validateAdapterRegistration({
      name: "Rotating",
      endpoint: "https://adapter.example/v1",
      kinds: ["llm"],
    });
    if (!validated.ok) throw new Error(validated.errors.join("; "));
    const created = await createAdapter(first.id, validated.draft);
    const now = new Date();
    const rotated = await rotateAdapterToken(first.id, created.adapter.id, {
      overlapMs: 1_000,
      now,
    });
    assert.ok(rotated !== undefined);
    if (rotated === undefined) return;

    assert.equal(
      await verifyAdapterToken(first.id, rotated.adapter.id, rotated.token, { now }),
      true
    );
    assert.equal(
      await verifyAdapterToken(first.id, rotated.adapter.id, created.token, { now }),
      true,
      "the old token is accepted during the overlap"
    );
    assert.equal(
      await verifyAdapterToken(first.id, rotated.adapter.id, created.token, {
        now: new Date(now.getTime() + 1_001),
      }),
      false,
      "the old token stops after the overlap"
    );

    await disableAdapter(first.id, rotated.adapter.id);
    assert.equal(
      await verifyAdapterToken(first.id, rotated.adapter.id, rotated.token),
      false,
      "disabling revokes the current token immediately"
    );
  });

  it("refuses a non-HTTPS endpoint and an empty kind list", () => {
    assert.equal(
      validateAdapterRegistration({
        name: "bad",
        endpoint: "http://adapter.example/v1",
        kinds: ["llm"],
      }).ok,
      false
    );
    assert.equal(
      validateAdapterRegistration({
        name: "bad",
        endpoint: "https://adapter.example/v1",
        kinds: [],
      }).ok,
      false
    );
  });
});

describe("manifest changes", () => {
  it("returns an adapter to pending when its manifest version changes", async () => {
    const first = await tenant("first");
    const validated = validateAdapterRegistration({
      name: "Manifest",
      endpoint: "https://adapter.example/v1",
      kinds: ["llm"],
    });
    if (!validated.ok) throw new Error(validated.errors.join("; "));
    const created = await createAdapter(first.id, validated.draft);

    const same = await applyAdapterManifest(first.id, created.adapter.id, {
      version: "1.0.0",
      body: { contract: 1 },
    });
    assert.equal(same?.status, "pending");
    await updateAdapterStatus(first.id, created.adapter.id, "verified");

    const changed = await applyAdapterManifest(first.id, created.adapter.id, {
      version: "1.1.0",
      body: { contract: 1 },
    });
    assert.equal(changed?.status, "pending");
  });
});

describe("adapter health", () => {
  it("marks an adapter down and removes it from the chain", async () => {
    const first = await tenant("first");
    const validated = validateAdapterRegistration({
      name: "Health",
      endpoint: "https://adapter.example/v1",
      kinds: ["llm"],
    });
    if (!validated.ok) throw new Error(validated.errors.join("; "));
    const created = await createAdapter(first.id, validated.draft);
    await updateAdapterStatus(first.id, created.adapter.id, "verified");

    assert.deepEqual(await resolveAdapterChain(first.id, "llm"), []);

    const [row] = await getDb()
      .select()
      .from(providerAdapters)
      .where(eq(providerAdapters.id, created.adapter.id));
    assert.equal(
      await checkAdapterHealth(row!, {
        fetchImpl: async () =>
          new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
      }),
      "ok"
    );
    assert.deepEqual(
      (await resolveAdapterChain(first.id, "llm")).map((entry) => entry.id),
      [created.adapter.id]
    );

    await checkAdapterHealth(row!, {
      fetchImpl: async () => new Response("down", { status: 503 }),
    });
    assert.deepEqual(await resolveAdapterChain(first.id, "llm"), []);
    assert.equal(await sweepAdapterHealth({ fetchImpl: async () => new Response("no", { status: 500 }) }), 1);
  });
});

describe("adapter benchmark", () => {
  it("stores WER, latency and verification against the adapter", async () => {
    const first = await tenant("first");
    const validated = validateAdapterRegistration({
      name: "Bench",
      endpoint: "https://adapter.example/v1",
      kinds: ["stt"],
    });
    if (!validated.ok) throw new Error(validated.errors.join("; "));
    const created = await createAdapter(first.id, validated.draft);
    await updateAdapterStatus(first.id, created.adapter.id, "verified");
    const [row] = await getDb()
      .select()
      .from(providerAdapters)
      .where(eq(providerAdapters.id, created.adapter.id));

    const report = await runVietnameseBenchmark(row!, created.token, {
      fixtures: [{ audio: Buffer.from("RIFF"), expected: "xin chào" }],
      fetchImpl: async () =>
        new Response(JSON.stringify({ text: "xin chào", language: "vi" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    assert.equal(report.wer, 0);

    const [stored] = await getDb()
      .select()
      .from(providerAdapters)
      .where(eq(providerAdapters.id, created.adapter.id));
    assert.equal(stored?.quality?.wer, 0);
    assert.equal((stored?.verification?.benchmark as { wer?: number }).wer, 0);
  });
});

describe("adapter egress", () => {
  it("records a call per tenant without any request text or audio", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const row = await recordAdapterEgress({
      tenantId: first.id,
      kind: "stt",
      region: "sg",
      bytes: 120,
      latencyMs: 42,
      status: "ok",
    });

    assert.deepEqual((await listTenantEgress(first.id)).map((event) => event.id), [row.id]);
    assert.deepEqual(await listTenantEgress(second.id), []);
    const keys = Object.keys(row);
    // `audioSeconds` is a measurement, not the recording: it names no content.
    assert.ok(
      !keys.some(
        (key) => key !== "audioSeconds" && /text|audio|body|request|response/i.test(key)
      )
    );
  });

  it("shows the platform every tenant's calls and a tenant only its own", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const mine = await recordAdapterEgress({ tenantId: first.id, kind: "llm", status: "ok" });
    const theirs = await recordAdapterEgress({ tenantId: second.id, kind: "tts", status: "ok" });

    assert.deepEqual(
      (await listAllEgress({ tenantId: first.id })).map((event) => event.id),
      [mine.id]
    );
    const all = (await listAllEgress()).map((event) => event.id);
    assert.ok(all.includes(mine.id) && all.includes(theirs.id));
    assert.deepEqual(
      (await listTenantEgress(first.id)).map((event) => event.id),
      [mine.id],
      "a tenant never sees another's"
    );
  });
});

describe("adapter chain resolution", () => {
  it("includes the tenant's and platform adapters, never another tenant's", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const platform = await adapter({ tenantId: null, name: "platform", kinds: ["llm"] });
    const mine = await adapter({ tenantId: first.id, name: "mine", kinds: ["llm"] });
    const theirs = await adapter({ tenantId: second.id, name: "theirs", kinds: ["llm"] });

    const chain = await resolveAdapterChain(first.id, "llm");
    assert.deepEqual(chain.map((entry) => entry.id), [mine.id, platform.id]);
    assert.ok(!chain.some((entry) => entry.id === theirs.id));
  });

  it("filters by kind, verification, health and the tenant's policy", async () => {
    const first = await tenant("first");
    const llm = await adapter({ tenantId: first.id, name: "llm", kinds: ["llm"] });
    await adapter({ tenantId: first.id, name: "stt", kinds: ["stt"] });
    await adapter({
      tenantId: first.id,
      name: "pending",
      kinds: ["llm"],
      status: "pending",
    });
    await adapter({
      tenantId: first.id,
      name: "unhealthy",
      kinds: ["llm"],
      health: "down",
    });

    assert.deepEqual(
      (await resolveAdapterChain(first.id, "llm")).map((entry) => entry.id),
      [llm.id]
    );
  });

  it("orders by the tenant's policy, then its own adapters, then quality", async () => {
    const first = await tenant("first");
    const platform = await adapter({
      tenantId: null,
      name: "platform",
      kinds: ["llm"],
      score: 99,
    });
    const low = await adapter({
      tenantId: first.id,
      name: "low",
      kinds: ["llm"],
      score: 1,
    });
    const high = await adapter({
      tenantId: first.id,
      name: "high",
      kinds: ["llm"],
      score: 10,
    });

    assert.deepEqual(
      (await resolveAdapterChain(first.id, "llm")).map((entry) => entry.id),
      [high.id, low.id, platform.id]
    );

    await getDb()
      .update(tenants)
      .set({ adapterPolicy: { order: [platform.id] } })
      .where(eq(tenants.id, first.id));
    assert.equal((await resolveAdapterChain(first.id, "llm"))[0]!.id, platform.id);
  });

  it("orders by latency when quality is equal", async () => {
    const first = await tenant("first");
    const slow = await adapter({
      tenantId: first.id,
      name: "slow",
      kinds: ["llm"],
      latency: 900,
    });
    const fast = await adapter({
      tenantId: first.id,
      name: "fast",
      kinds: ["llm"],
      latency: 120,
    });

    assert.deepEqual(
      (await resolveAdapterChain(first.id, "llm")).map((entry) => entry.id),
      [fast.id, slow.id]
    );
  });

  it("keeps no speech adapter and only local llm adapters when the policy is local-only", async () => {
    const first = await tenant("first");
    const remote = await adapter({
      tenantId: first.id,
      name: "remote",
      kinds: ["stt"],
      remote: true,
    });
    const local = await adapter({
      tenantId: first.id,
      name: "local",
      kinds: ["stt"],
      remote: false,
    });
    const remoteLlm = await adapter({
      tenantId: first.id,
      name: "remote-llm",
      kinds: ["llm"],
      remote: true,
    });
    const localLlm = await adapter({
      tenantId: first.id,
      name: "local-llm",
      kinds: ["llm"],
      remote: false,
    });

    await getDb()
      .update(tenants)
      .set({ adapterPolicy: { localOnly: true } })
      .where(eq(tenants.id, first.id));

    // Local-only speech is platform speech only: even a speech adapter that
    // declares itself local is excluded.
    const speechIds = (await resolveAdapterChain(first.id, "stt")).map((entry) => entry.id);
    assert.equal(speechIds.length, 0, "local-only speech keeps no adapter");
    assert.ok(!speechIds.includes(remote.id) && !speechIds.includes(local.id));

    const llm = await resolveAdapterChain(first.id, "llm");
    assert.deepEqual(llm.map((entry) => entry.id), [localLlm.id]);
    assert.ok(!llm.some((entry) => entry.id === remoteLlm.id));
  });

  it("answers an empty chain for a tenant that does not exist", async () => {
    assert.deepEqual(
      await resolveAdapterChain("00000000-0000-4000-8000-000000000000", "llm"),
      []
    );
  });
});

describe("adapter capability checks", () => {
  it("skips an adapter that declares no tool support", async () => {
    const first = await tenant("first");
    const plain = await adapter({ tenantId: first.id, name: "plain", kinds: ["llm"] });
    const tools = await adapter({
      tenantId: first.id,
      name: "tools",
      kinds: ["llm"],
      capabilities: { tools: true },
    });

    const chain = await resolveAdapterChain(first.id, "llm", { requires: { tools: true } });
    assert.deepEqual(chain.map((entry) => entry.id), [tools.id]);
    assert.ok(!chain.some((entry) => entry.id === plain.id));
  });

  it("skips an adapter that does not declare the turn's languages", async () => {
    const first = await tenant("first");
    const bilingual = await adapter({
      tenantId: first.id,
      name: "bilingual",
      kinds: ["stt"],
      capabilities: { languages: ["vi", "en"] },
    });
    await adapter({
      tenantId: first.id,
      name: "english-only",
      kinds: ["stt"],
      capabilities: { languages: ["en"] },
    });

    const chain = await resolveAdapterChain(first.id, "stt", {
      requires: { languages: ["vi"] },
    });
    assert.deepEqual(chain.map((entry) => entry.id), [bilingual.id]);
  });

  it("skips an adapter that declares no streaming", async () => {
    const first = await tenant("first");
    const streaming = await adapter({
      tenantId: first.id,
      name: "streaming",
      kinds: ["llm"],
      capabilities: { streaming: true },
    });
    await adapter({ tenantId: first.id, name: "buffered", kinds: ["llm"] });

    const chain = await resolveAdapterChain(first.id, "llm", {
      requires: { streaming: true },
    });
    assert.deepEqual(chain.map((entry) => entry.id), [streaming.id]);
  });
});

describe("saving the routing policy", () => {
  it("changes the selection the next resolution makes", async () => {
    const first = await tenant("first");
    const remote = await adapter({
      tenantId: first.id,
      name: "remote",
      kinds: ["llm"],
      remote: true,
    });
    const local = await adapter({
      tenantId: first.id,
      name: "local",
      kinds: ["llm"],
      remote: false,
    });

    assert.deepEqual(
      await saveAdapterPolicy(first.id, {
        localOnly: true,
        order: [],
        monthlyBudgetUsd: 25,
      }),
      { localOnly: true, order: [], monthlyBudgetUsd: 25 }
    );
    assert.deepEqual(
      (await resolveAdapterChain(first.id, "llm")).map((entry) => entry.id),
      [local.id],
      "local-only excludes the remote adapter"
    );

    await saveAdapterPolicy(first.id, {
      localOnly: false,
      order: [remote.id],
      monthlyBudgetUsd: null,
    });
    assert.equal(
      (await resolveAdapterChain(first.id, "llm"))[0]?.id,
      remote.id,
      "the saved order is the fallback order"
    );
  });

  it("refuses a malformed policy", () => {
    for (const bad of [
      null,
      { localOnly: "yes" },
      { order: [1] },
      { monthlyBudgetUsd: -1 },
    ]) {
      assert.equal(validateAdapterPolicy(bad).ok, false, JSON.stringify(bad));
    }
    assert.equal(
      validateAdapterPolicy({ localOnly: true, order: ["a"], monthlyBudgetUsd: 3 }).ok,
      true
    );
  });
});

describe("adapter policy", () => {
  it("reads only the fields it defines", () => {
    assert.deepEqual(readAdapterPolicy(undefined), { localOnly: false, order: [] });
    assert.deepEqual(readAdapterPolicy({ localOnly: true, order: ["a", 2, "b"] }), {
      localOnly: true,
      order: ["a", "b"],
    });
    assert.deepEqual(readAdapterPolicy({ localOnly: "yes", order: "a" }), {
      localOnly: false,
      order: [],
    });
  });
});
