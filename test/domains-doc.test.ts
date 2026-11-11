import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const DOMAINS = new URL("../docs/DOMAINS.md", import.meta.url);
const CADDY = new URL("../deploy/Caddyfile.example", import.meta.url);
const PROVISIONING = new URL("../docs/PROVISIONING.md", import.meta.url);
const RUNBOOK = new URL("../docs/RUNBOOK.md", import.meta.url);

describe("the domain and TLS guide", () => {
  it("names registration, DNS, the listener and the verification probes", async () => {
    const document = await readFile(DOMAINS, "utf8");

    for (const name of [
      "tenant_domains",
      "gc_session",
      "/api/admin/tenants/<tenant-id>/domains",
      "/api/internal/tenant-domains/check",
      "deploy/Caddyfile.example",
      "PLATFORM_HOST",
      "/xiaozhi/ota*",
      "/xiaozhi/v1*",
      "openssl s_client",
      "DNS only",
    ]) {
      assert.ok(document.includes(name), `the guide names ${name}`);
    }
  });

  it("matches the Caddy listener it points at", async () => {
    const caddy = await readFile(CADDY, "utf8");

    assert.ok(caddy.includes("on_demand_tls"));
    assert.ok(caddy.includes("http://127.0.0.1:3001/api/internal/tenant-domains/check"));
    assert.ok(caddy.includes("tls {\n\t\ton_demand"));
    assert.ok(caddy.includes("/xiaozhi/ota*"));
    assert.ok(caddy.includes("/xiaozhi/v1*"));
    assert.ok(caddy.includes("reverse_proxy 127.0.0.1:3001"));
  });

  it("is the guide the provisioning and runbook documents point to", async () => {
    assert.ok((await readFile(PROVISIONING, "utf8")).includes("docs/DOMAINS.md"));
    assert.ok((await readFile(RUNBOOK, "utf8")).includes("docs/DOMAINS.md"));
  });
});
