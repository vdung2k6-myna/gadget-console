import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const DOC = new URL("../docs/ADAPTERS.md", import.meta.url);

describe("the adapter token guide", () => {
  it("names every implemented route and the one-time rule", async () => {
    const document = await readFile(DOC, "utf8");
    for (const name of [
      "POST \"https://<console-host>/api/admin/adapters\"",
      "curl -sS \"https://<console-host>/api/admin/adapters\"",
      "/api/admin/adapters/<adapter-id>/rotate",
      "/api/admin/adapters/<adapter-id>/disable",
      "adp_",
      "shown once",
      "previousExpiresAt",
      "pending",
    ]) {
      assert.ok(document.includes(name), `the guide names ${name}`);
    }
  });
});
