import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const DOC = new URL("../docs/TENANCY.md", import.meta.url);

describe("the tenancy enforcement document", () => {
  it("names the repository surface, the matrix and the RLS plan", async () => {
    const document = await readFile(DOC, "utf8");

    for (const name of [
      "asTenantContext",
      "ownedBy",
      "findDeviceByDeviceId",
      "listDevices",
      "listAgents",
      "listBuiltInProfiles",
      "listClaims",
      "listTurns",
      "listFirmware",
      "listUsage",
    ]) {
      assert.ok(document.includes(name), `the document names ${name}`);
    }

    assert.ok(document.includes("test/tenancy-isolation.test.ts"));
    assert.ok(document.includes("SET LOCAL app.tenant_id"));
    assert.ok(document.includes("Platform built-ins"));
  });
});
