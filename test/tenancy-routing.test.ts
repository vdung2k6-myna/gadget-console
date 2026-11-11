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

function withPlatformHost<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.PLATFORM_HOST;
  process.env.PLATFORM_HOST = "admin.example.com";
  return run().finally(() => {
    if (previous === undefined) delete process.env.PLATFORM_HOST;
    else process.env.PLATFORM_HOST = previous;
  });
}

describe("tenant routing proxy", () => {
  it("rewrites the path fallback and keeps the tenant path", async () => {
    const response = await proxy(
      new NextRequest("http://console.test/t/acme/devices?page=2")
    );

    assert.equal(
      response.headers.get("x-middleware-rewrite"),
      "http://console.test/devices?page=2"
    );
  });

  it("serves a registered console host", async () => {
    await tenant("acme", "console.acme.example");

    const response = await proxy(
      new NextRequest("http://console.acme.example/devices", {
        headers: { host: "console.acme.example" },
      })
    );

    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  it("refuses an unregistered host when the platform host is set", async () => {
    await withPlatformHost(async () => {
      const response = await proxy(
        new NextRequest("http://unknown.example.com/devices", {
          headers: { host: "unknown.example.com" },
        })
      );
      assert.equal(response.status, 404);
    });
  });

  it("lets a loopback request through when the platform host is set", async () => {
    await withPlatformHost(async () => {
      const response = await proxy(
        new NextRequest(
          "http://127.0.0.1:3001/api/internal/tenant-domains/check?domain=console.example",
          {
            headers: {
              host: "127.0.0.1:3001",
              "x-forwarded-for": "::ffff:127.0.0.1",
            },
          }
        )
      );
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });
  });

  it("refuses a loopback host with a public address in its forwarded chain", async () => {
    await withPlatformHost(async () => {
      const response = await proxy(
        new NextRequest("http://127.0.0.1:3001/api/internal/tenant-domains/check", {
          headers: {
            host: "127.0.0.1:3001",
            "x-forwarded-for": "203.0.113.7",
          },
        })
      );
      assert.equal(response.status, 404);
    });
  });
});
