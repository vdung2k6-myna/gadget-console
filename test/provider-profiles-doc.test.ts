import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const DOC = new URL("../docs/PROVIDER_PROFILES.md", import.meta.url);

describe("the provider profile document", () => {
  it("names the scopes, routes and tests", async () => {
    const document = await readFile(DOC, "utf8");

    for (const term of [
      "platform built-in",
      "tenant built-in",
      "account-owned",
      "listTenantBuiltins",
      "publishTenantBuiltin",
      "/api/admin/provider-profiles",
      "/admin/provider-profiles",
      "test/tenancy-provider-profiles.test.ts",
      "test/provider-seed.test.ts",
    ]) {
      assert.ok(document.includes(term), `the document names ${term}`);
    }
  });
});
