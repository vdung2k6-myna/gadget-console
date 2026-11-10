import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { GET } from "../src/app/api/internal/tenant-domains/check/route";
import { tenantDomains, tenants } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

const CHECK = "http://127.0.0.1:3001/api/internal/tenant-domains/check";

function ask(domain: string, headers: Record<string, string>) {
  return new Request(`${CHECK}?domain=${encodeURIComponent(domain)}`, { headers });
}

async function tenant(domain: string) {
  const rows = await getDb()
    .insert(tenants)
    .values({ name: "first", slug: "first" })
    .returning();
  await getDb()
    .insert(tenantDomains)
    .values({ tenantId: rows[0]!.id, domain, kind: "console" });
}

describe("the certificate authorization route", () => {
  it("allows a registered host over loopback", async () => {
    await tenant("console.first.example");

    const response = await GET(ask("console.first.example", { host: "127.0.0.1:3001" }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { allowed: true });
  });

  it("refuses a host that is not registered", async () => {
    const response = await GET(ask("unknown.example", { host: "127.0.0.1:3001" }));

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { allowed: false });
  });

  it("refuses a request that came through the front", async () => {
    await tenant("console.first.example");

    const response = await GET(
      ask("console.first.example", {
        host: "127.0.0.1:3001",
        "x-forwarded-for": "203.0.113.7",
      })
    );

    assert.equal(response.status, 404);
  });
});
