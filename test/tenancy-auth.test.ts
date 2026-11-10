import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { authenticate, registerAccount } from "../src/lib/auth/accounts";
import { tenants } from "../src/lib/db/schema";

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

describe("tenant-scoped registration and sign-in", () => {
  it("registers a user in the resolved tenant", async () => {
    const first = await tenant("first");
    const registered = await registerAccount("ann@example.com", "a good password", first.id);
    assert.equal(registered.ok, true);
    if (!registered.ok) return;

    assert.equal(registered.user.tenantId, first.id);
    assert.equal(registered.user.role, "user");
  });

  it("signs in only on the account's tenant", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    await registerAccount("ann@example.com", "a good password", first.id);

    assert.equal(
      (await authenticate("ann@example.com", "a good password", first.id))?.tenantId,
      first.id
    );
    assert.equal(await authenticate("ann@example.com", "a good password", second.id), undefined);
    assert.equal(await authenticate("ann@example.com", "a good password", null), undefined);
  });

  it("answers a platform admin only on the platform scope", async () => {
    await registerAccount("operator@example.com", "a good password", null);

    assert.equal(
      (await authenticate("operator@example.com", "a good password", null))?.tenantId,
      null
    );
    const first = await tenant("first");
    assert.equal(
      await authenticate("operator@example.com", "a good password", first.id),
      undefined
    );
  });
});
