import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const DOC = new URL("../docs/ONBOARDING.md", import.meta.url);
const DOMAINS = new URL("../docs/DOMAINS.md", import.meta.url);
const ROLES = new URL("../docs/ROLES.md", import.meta.url);
const TENANCY = new URL("../docs/TENANCY.md", import.meta.url);

describe("the tenant onboarding guide", () => {
  it("names the create, bootstrap, promote and settings path", async () => {
    const document = await readFile(DOC, "utf8");

    for (const name of [
      "/admin/platform",
      "/api/admin/tenants",
      "/t/<tenant-slug>/api/auth/register",
      "/api/admin/users/<user-id>/role",
      "tenant_admin",
      "/admin/settings",
      "tenant_domains",
      "deploy/Caddyfile.example",
      "PLATFORM_HOST",
      "/xiaozhi/ota/",
      "/admin/claims",
    ]) {
      assert.ok(document.includes(name), `the guide names ${name}`);
    }
  });

  it("points at the domain, role, tenancy and deployment documents", async () => {
    const document = await readFile(DOC, "utf8");

    for (const name of ["docs/DOMAINS.md", "docs/ROLES.md", "docs/TENANCY.md", "docs/DEPLOYMENT.md"]) {
      assert.ok(document.includes(name), `the guide links ${name}`);
    }
    assert.ok((await readFile(DOMAINS, "utf8")).includes("tenant_domains"));
    assert.ok((await readFile(ROLES, "utf8")).includes("requireTenantAdminSurface"));
    assert.ok((await readFile(TENANCY, "utf8")).includes("exportTenant"));
  });

  it("states the lifecycle effects the platform page implements", async () => {
    const document = await readFile(DOC, "utf8");
    assert.ok(document.includes("Suspend"));
    assert.ok(document.includes("Export"));
    assert.ok(document.includes("Delete"));
    assert.ok(document.includes("slug"));
    assert.ok(document.includes("audit"));
  });
});
