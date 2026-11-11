import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { providerAdapters, tenants } from "../src/lib/db/schema";
import {
  readAdapterPolicy,
  resolveAdapterChain,
} from "../src/lib/tenancy/adapters";

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
