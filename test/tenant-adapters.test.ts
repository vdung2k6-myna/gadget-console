import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { auditEvents, providerAdapters, tenants } from "../src/lib/db/schema";
import {
  readAdapterPolicy,
  resolveAdapterChain,
} from "../src/lib/tenancy/adapters";
import {
  listTenantEgress,
  recordAdapterEgress,
} from "../src/lib/adapter-egress";
import { decryptSecret } from "../src/lib/crypto/secret-box";
import { encryptionKeyForTenant } from "../src/lib/crypto/profiles";
import {
  createAdapter,
  disableAdapter,
  getAdapter,
  listAdapters,
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
    assert.ok(!keys.some((key) => /text|audio|body|request|response/i.test(key)));
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

  it("keeps only local adapters when the policy is local-only", async () => {
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

    await getDb()
      .update(tenants)
      .set({ adapterPolicy: { localOnly: true } })
      .where(eq(tenants.id, first.id));

    const chain = await resolveAdapterChain(first.id, "stt");
    assert.deepEqual(chain.map((entry) => entry.id), [local.id]);
    assert.ok(!chain.some((entry) => entry.id === remote.id));
  });

  it("answers an empty chain for a tenant that does not exist", async () => {
    assert.deepEqual(
      await resolveAdapterChain("00000000-0000-4000-8000-000000000000", "llm"),
      []
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
