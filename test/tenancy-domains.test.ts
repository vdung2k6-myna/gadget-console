import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import {
  canIssueCertificate,
  listTenantDomains,
  registerTenantDomain,
  removeTenantDomain,
} from "../src/lib/tenancy/domains";
import { tenants } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

const UNKNOWN_TENANT = "00000000-0000-0000-0000-000000000000";

async function tenant(slug: string) {
  const rows = await getDb()
    .insert(tenants)
    .values({ name: slug, slug })
    .returning();
  return rows[0]!;
}

describe("tenant domains", () => {
  it("registers a console host under its normalized name", async () => {
    const first = await tenant("first");

    const registered = await registerTenantDomain(first.id, {
      domain: "HTTPS://Console.First.Example:8443/",
      kind: "console",
    });

    assert.equal(registered.ok, true);
    if (!registered.ok) return;
    assert.equal(registered.domain.tenantId, first.id);
    assert.equal(registered.domain.domain, "console.first.example");
    assert.equal(registered.domain.kind, "console");

    const domains = await listTenantDomains(first.id);
    assert.equal(domains.length, 1);
    assert.equal(domains[0]!.domain, "console.first.example");
  });

  it("refuses the same host for another tenant", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    assert.equal(
      (await registerTenantDomain(first.id, { domain: "console.example", kind: "console" })).ok,
      true
    );

    const duplicate = await registerTenantDomain(second.id, {
      domain: "console.example",
      kind: "console",
    });

    assert.deepEqual(duplicate, { ok: false, reason: "domain-taken" });
    assert.equal((await listTenantDomains(second.id)).length, 0);
  });

  it("refuses the same host for the same tenant", async () => {
    const first = await tenant("first");
    assert.equal(
      (await registerTenantDomain(first.id, { domain: "console.example", kind: "console" })).ok,
      true
    );

    const duplicate = await registerTenantDomain(first.id, {
      domain: "console.example",
      kind: "console",
    });

    assert.deepEqual(duplicate, { ok: false, reason: "domain-taken" });
  });

  it("allows one host of each kind and refuses a second console host", async () => {
    const first = await tenant("first");
    assert.equal(
      (await registerTenantDomain(first.id, { domain: "console.example", kind: "console" })).ok,
      true
    );
    assert.equal(
      (await registerTenantDomain(first.id, { domain: "gw.example", kind: "gateway" })).ok,
      true
    );

    const secondConsole = await registerTenantDomain(first.id, {
      domain: "console-2.example",
      kind: "console",
    });

    assert.deepEqual(secondConsole, { ok: false, reason: "kind-taken" });
    assert.equal((await listTenantDomains(first.id)).length, 2);
  });

  it("refuses an invalid host, an invalid kind and an unknown tenant", async () => {
    const first = await tenant("first");

    assert.deepEqual(
      await registerTenantDomain(first.id, { domain: "not a host", kind: "console" }),
      { ok: false, reason: "invalid-domain" }
    );
    assert.deepEqual(
      await registerTenantDomain(first.id, { domain: "console.example", kind: "web" }),
      { ok: false, reason: "invalid-kind" }
    );
    assert.deepEqual(
      await registerTenantDomain(UNKNOWN_TENANT, { domain: "console.example", kind: "console" }),
      { ok: false, reason: "tenant-not-found" }
    );
  });

  it("removes a host and frees it for another tenant", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const registered = await registerTenantDomain(first.id, {
      domain: "console.example",
      kind: "console",
    });
    assert.equal(registered.ok, true);
    if (!registered.ok) return;

    assert.equal(await removeTenantDomain(second.id, registered.domain.id), false);
    assert.equal(await removeTenantDomain(first.id, registered.domain.id), true);
    assert.equal((await listTenantDomains(first.id)).length, 0);

    assert.equal(
      (await registerTenantDomain(second.id, { domain: "console.example", kind: "console" })).ok,
      true
    );
  });

  it("authorizes a certificate only for a live registered host", async () => {
    const first = await tenant("first");
    assert.equal(
      (await registerTenantDomain(first.id, { domain: "console.example", kind: "console" })).ok,
      true
    );
    assert.equal(
      (await registerTenantDomain(first.id, { domain: "gw.example", kind: "gateway" })).ok,
      true
    );

    assert.equal(await canIssueCertificate("console.example"), true);
    assert.equal(await canIssueCertificate("HTTPS://GW.Example:443/"), true);
    assert.equal(await canIssueCertificate("unknown.example"), false);
    assert.equal(await canIssueCertificate(undefined), false);

    await getDb().update(tenants).set({ status: "deleted" }).where(eq(tenants.id, first.id));
    assert.equal(await canIssueCertificate("console.example"), false);
  });
});
