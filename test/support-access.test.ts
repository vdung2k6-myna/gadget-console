import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { listTenantAudit } from "../src/lib/audit";
import { registerAccount } from "../src/lib/auth/accounts";
import { devices, tenants } from "../src/lib/db/schema";
import {
  SUPPORT_ACCESS_TTL_MS,
  SUPPORT_ACTION,
  findSupportDevice,
  openSupportConversation,
  supportAccessGrant,
} from "../src/lib/support-access";

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

async function account(email: string, tenantId: string) {
  const result = await registerAccount(email, "a good password", tenantId);
  if (!result.ok) throw new Error(`could not register ${email}`);
  return result.user;
}

async function device(tenantId: string, deviceId: string) {
  const rows = await getDb()
    .insert(devices)
    .values({ tenantId, deviceId, secret: "s".repeat(32), name: "" })
    .returning();
  return rows[0]!;
}

describe("support access", () => {
  it("gates a device to the actor's tenant unless the actor is a platform admin", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const ann = await account("ann@example.com", first.id);
    const mine = await device(first.id, "adevice");
    const theirs = await device(second.id, "bdevice");

    const support = { id: ann.id, email: ann.email, role: "support", tenantId: first.id };
    assert.equal((await findSupportDevice(support, mine.id))?.id, mine.id);
    assert.equal(await findSupportDevice(support, theirs.id), undefined);

    const platform = {
      id: "root",
      email: "root@example.com",
      role: "platform_admin",
      tenantId: null,
    };
    assert.equal((await findSupportDevice(platform, theirs.id))?.id, theirs.id);
  });

  it("records the access and only honours the actor's grant for that device", async () => {
    const first = await tenant("first");
    const second = await tenant("second");
    const ann = await account("ann@example.com", first.id);
    const bob = await account("bob@example.com", second.id);
    const mine = await device(first.id, "adevice");
    const theirs = await device(second.id, "bdevice");

    const support = { id: ann.id, email: ann.email, role: "support", tenantId: first.id };
    const access = await openSupportConversation(support, mine);
    assert.ok(access !== undefined);
    if (access === undefined) return;

    const audit = await listTenantAudit(first.id, { actionPrefix: "support." });
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.id, access.id);
    assert.equal(audit[0]!.actorEmail, "ann@example.com");
    assert.equal(audit[0]!.action, SUPPORT_ACTION);
    assert.equal(audit[0]!.targetId, mine.id);
    assert.equal(audit[0]!.metadata?.deviceId, "adevice");
    assert.equal(await listTenantAudit(second.id, { actionPrefix: "support." }).then((rows) => rows.length), 0);

    assert.equal(
      (await supportAccessGrant({ accessId: access.id, actorEmail: ann.email, device: mine }))
        ?.getTime(),
      access.expiresAt.getTime()
    );
    assert.equal(
      await supportAccessGrant({ accessId: access.id, actorEmail: bob.email, device: mine }),
      undefined
    );
    assert.equal(
      await supportAccessGrant({ accessId: access.id, actorEmail: ann.email, device: theirs }),
      undefined
    );
    assert.equal(
      await supportAccessGrant({
        accessId: access.id,
        actorEmail: ann.email,
        device: mine,
        now: new Date(Date.now() + SUPPORT_ACCESS_TTL_MS + 1),
      }),
      undefined
    );
  });

  it("refuses a device with no tenant", async () => {
    const [orphan] = await getDb()
      .insert(devices)
      .values({ deviceId: "cdevice", secret: "s".repeat(32), name: "" })
      .returning();

    assert.equal(
      await openSupportConversation(
        { id: "root", email: "root@example.com", role: "platform_admin", tenantId: null },
        orphan!
      ),
      undefined
    );
  });
});
