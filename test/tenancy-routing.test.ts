import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import proxy from "../src/proxy";
import { tenantDomains, tenants } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

async function tenant(slug: string, domain: string) {
  const rows = await getDb().insert(tenants).values({ name: slug, slug }).returning();
  await getDb()
    .insert(tenantDomains)
    .values({ tenantId: rows[0]!.id, domain, kind: "console" });
  return rows[0]!;
}

describe("tenant routing proxy", () => {
  it("rewrites the path fallback and keeps the tenant path", async () => {
    const response = await proxy(
      new NextRequest("http://console.test/t/acme/devices?page=2"),
    );

    assert.equal(
      response.headers.get("x-middleware-rewrite"),
      "http://console.test/devices?page=2"
    );
  });

  it("serves a registered console host", async () => {
    await tenant("acme", "console.acme.example");

    const response = await proxy(
      new NextRequest("http://console.acme.example/devices"),
    );

    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  it("refuses an unregistered host when the platform host is set", async () => {
    const previous = process.env.PLATFORM_HOST;
    process.env.PLATFORM_HOST = "admin.example.com";
    try {
      const response = await proxy(
        new NextRequest("http://unknown.example.com/devices")
      );
      assert.equal(response.status, 404);
    } finally {
      if (previous === undefined) delete process.env.PLATFORM_HOST;
      else process.env.PLATFORM_HOST = previous;
    }
  });
});
