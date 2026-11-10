import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { USER_ROLES } from "../src/lib/auth/roles";

const DOC = new URL("../docs/ROLES.md", import.meta.url);

describe("the role matrix document", () => {
  it("names every role and guard the code defines", async () => {
    const document = await readFile(DOC, "utf8");

    for (const role of USER_ROLES) {
      assert.ok(document.includes(`\`${role}\``), `the document names ${role}`);
    }
    for (const guard of [
      "requirePlatformAdmin",
      "requireTenantAdmin",
      "requireSupport",
      "requireAdmin",
      "canAccessTenant",
      "isProtectedAdmin",
    ]) {
      assert.ok(document.includes(guard), `the document names ${guard}`);
    }
  });
});
