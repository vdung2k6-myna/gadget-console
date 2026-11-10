import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { tenantDomains, tenants } from "../src/lib/db/schema";
import { parseTenantRequest } from "../src/lib/tenancy/request";
import { resolveConsoleTenant } from "../src/lib/tenancy/resolve";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function seedTenant(slug: string, domain: string) {
  const [tenant] = await getDb()
    .insert(tenants)
    .values({ name: slug, slug })
    .returning();
  await getDb().insert(tenantDomains).values({ tenantId: tenant.id, domain, kind: "console" });
  return tenant;
}

describe("tenant request parsing", () => {
  it("classifies a tenant host, the platform host and an unknown host", () => {
    assert.deepEqual(
      parseTenantRequest({
        host: "Console.Acme.Example:3001",
        pathname: "/agents",
        platformHost: "admin.example.com",
      }),
      { kind: "tenant", source: "host", host: "console.acme.example", pathname: "/agents" }
    );

    assert.deepEqual(
      parseTenantRequest({
        host: "admin.example.com",
        pathname: "/",
        platformHost: "admin.example.com",
      }),
      { kind: "platform", pathname: "/" }
    );

    assert.deepEqual(parseTenantRequest({ host: null, pathname: "/" }), {
      kind: "unknown",
      pathname: "/",
    });
  });

  it("reads the path fallback and strips it", () => {
    assert.deepEqual(parseTenantRequest({ host: null, pathname: "/t/acme/agents" }), {
      kind: "tenant",
      source: "path",
      slug: "acme",
      pathname: "/agents",
    });
  });
});

describe("tenant resolution", () => {
  it("resolves a registered console host", async () => {
    const tenant = await seedTenant("acme", "console.acme.example");
    const resolved = await resolveConsoleTenant({
      host: "console.acme.example",
      pathname: "/",
      platformHost: "admin.example.com",
    });

    assert.equal(resolved.kind, "tenant");
    if (resolved.kind === "tenant") {
      assert.equal(resolved.tenant.id, tenant.id);
      assert.equal(resolved.source, "host");
    }
  });

  it("resolves the path slug", async () => {
    const tenant = await seedTenant("acme", "console.acme.example");
    const resolved = await resolveConsoleTenant({ host: null, pathname: "/t/acme/setup" });

    assert.equal(resolved.kind, "tenant");
    if (resolved.kind === "tenant") {
      assert.equal(resolved.tenant.id, tenant.id);
      assert.equal(resolved.pathname, "/setup");
    }
  });

  it("returns platform for the platform host and unknown for an unregistered host", async () => {
    const platform = await resolveConsoleTenant({
      host: "admin.example.com",
      pathname: "/",
      platformHost: "admin.example.com",
    });
    assert.equal(platform.kind, "platform");

    const unknown = await resolveConsoleTenant({
      host: "unknown.example.com",
      pathname: "/",
      platformHost: "admin.example.com",
    });
    assert.equal(unknown.kind, "unknown");
  });

  it("answers unknown for an unregistered path slug", async () => {
    const resolved = await resolveConsoleTenant({ host: null, pathname: "/t/missing/agents" });
    assert.equal(resolved.kind, "unknown");
  });

  it("stops serving a deleted tenant's host", async () => {
    const tenant = await seedTenant("acme", "console.acme.example");
    await getDb().update(tenants).set({ status: "deleted" }).where(eq(tenants.id, tenant.id));

    const resolved = await resolveConsoleTenant({
      host: "console.acme.example",
      pathname: "/",
    });
    assert.equal(resolved.kind, "unknown");
  });
});
