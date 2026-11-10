import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { recordUsage, usageReport } from "../src/lib/tenancy/usage";
import { tenants } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

const HOUR = 60 * 60 * 1000;

async function tenant(slug: string, speechAllowanceSeconds: number | null) {
  const rows = await getDb()
    .insert(tenants)
    .values({ name: slug, slug, speechAllowanceSeconds })
    .returning();
  return rows[0]!;
}

function since(now = Date.now()): Date {
  return new Date(now - HOUR);
}

describe("usage and allowance", () => {
  it("bills platform speech over the allowance and records reseller speech unbilled", async () => {
    const first = await tenant("first", 10);
    const now = Date.now();

    await recordUsage({
      tenantId: first.id,
      kind: "speech",
      source: "platform",
      provider: "platform",
      seconds: 15,
    });
    await recordUsage({
      tenantId: first.id,
      kind: "speech",
      source: "reseller",
      provider: "reseller",
      seconds: 5,
    });
    await recordUsage({
      tenantId: first.id,
      kind: "llm",
      source: "platform",
      bytes: 100,
    });

    const report = await usageReport(first.id, { since: since(now) });
    assert.equal(report.platformSeconds, 15);
    assert.equal(report.resellerSeconds, 5);
    assert.equal(report.allowanceSeconds, 10);
    assert.equal(report.overageSeconds, 5);
    assert.equal(report.billableSeconds, 5);
  });

  it("uses no allowance when the tenant sets none", async () => {
    const first = await tenant("first", null);
    await recordUsage({
      tenantId: first.id,
      kind: "speech",
      source: "platform",
      seconds: 3,
    });

    const report = await usageReport(first.id, { since: since() });
    assert.equal(report.allowanceSeconds, 0);
    assert.equal(report.overageSeconds, 3);
    assert.equal(report.billableSeconds, 3);
  });

  it("honours an explicit allowance override", async () => {
    const first = await tenant("first", 10);
    await recordUsage({
      tenantId: first.id,
      kind: "speech",
      source: "platform",
      seconds: 4,
    });

    const report = await usageReport(first.id, { since: since(), allowanceSeconds: 2 });
    assert.equal(report.allowanceSeconds, 2);
    assert.equal(report.overageSeconds, 2);
  });

  it("never bills reseller speech", async () => {
    const first = await tenant("first", 0);
    await recordUsage({
      tenantId: first.id,
      kind: "speech",
      source: "reseller",
      seconds: 9,
    });

    const report = await usageReport(first.id, { since: since() });
    assert.equal(report.resellerSeconds, 9);
    assert.equal(report.overageSeconds, 0);
    assert.equal(report.billableSeconds, 0);
  });

  it("refuses an invalid source or a negative amount", async () => {
    await assert.rejects(
      () =>
        recordUsage({
          tenantId: "x",
          kind: "speech",
          source: "bad" as "platform",
        }),
      /source/
    );
    await assert.rejects(
      () =>
        recordUsage({
          tenantId: "x",
          kind: "speech",
          source: "platform",
          seconds: -1,
        }),
      /seconds/
    );
  });
});
