import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  canAccessTenant,
  canSupport,
  isAdminRole,
  isPlatformAdmin,
  isSupportRole,
  isTenantAdmin,
  isUserRole,
} from "../src/lib/auth/roles";

describe("the tenant role matrix", () => {
  it("distinguishes the four roles", () => {
    assert.equal(isPlatformAdmin("platform_admin"), true);
    assert.equal(isTenantAdmin("tenant_admin"), true);
    assert.equal(isSupportRole("support"), true);
    assert.equal(isUserRole("user"), true);

    assert.equal(isAdminRole("platform_admin"), true);
    assert.equal(isAdminRole("tenant_admin"), true);
    assert.equal(isAdminRole("support"), false);
    assert.equal(isAdminRole("user"), false);

    assert.equal(canSupport("platform_admin"), true);
    assert.equal(canSupport("tenant_admin"), true);
    assert.equal(canSupport("support"), true);
    assert.equal(canSupport("user"), false);
  });

  it("lets a platform admin any tenant and everyone else only its own", () => {
    assert.equal(canAccessTenant({ role: "platform_admin", tenantId: null }, "a"), true);
    assert.equal(canAccessTenant({ role: "platform_admin", tenantId: null }, "b"), true);
    assert.equal(canAccessTenant({ role: "tenant_admin", tenantId: "a" }, "a"), true);
    assert.equal(canAccessTenant({ role: "tenant_admin", tenantId: "a" }, "b"), false);
    assert.equal(canAccessTenant({ role: "support", tenantId: "a" }, "b"), false);
    assert.equal(canAccessTenant({ role: "user", tenantId: "a" }, "a"), true);
  });
});
