import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  forbiddenAddress,
  redirectAllowed,
  validateAdapterEndpoint,
} from "../src/lib/adapter-endpoint";

const publicResolver = async () => [{ address: "203.0.113.10", family: 4 }];

describe("adapter endpoint validation", () => {
  it("accepts a public HTTPS host", async () => {
    const result = await validateAdapterEndpoint("https://adapter.example/v1", {
      resolve: publicResolver,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.addresses, ["203.0.113.10"]);
  });

  it("refuses each unsafe URL shape", async () => {
    const cases: Array<[string, string]> = [
      ["http://adapter.example/v1", "not-https"],
      ["https://adapter.example:8443/v1", "has-port"],
      ["https://user:pass@adapter.example/v1", "credentials"],
      ["https://localhost/v1", "loopback"],
      ["https://127.0.0.1/v1", "loopback"],
      ["https://[::1]/v1", "loopback"],
      ["https://10.0.0.1/v1", "private"],
      ["https://[fc00::1]/v1", "private"],
      ["https://169.254.1.1/v1", "link-local"],
      ["https://[fe80::1]/v1", "link-local"],
      ["https://0.0.0.0/v1", "unspecified"],
    ];
    for (const [endpoint, reason] of cases) {
      const result = await validateAdapterEndpoint(endpoint, { resolve: publicResolver });
      assert.equal(result.ok, false, endpoint);
      if (!result.ok) assert.equal(result.reason, reason, endpoint);
    }
  });

  it("refuses a name that resolves to a private address or does not resolve", async () => {
    const privateName = await validateAdapterEndpoint("https://adapter.example/v1", {
      resolve: async () => [
        { address: "203.0.113.10", family: 4 },
        { address: "10.1.2.3", family: 4 },
      ],
    });
    assert.equal(privateName.ok, false);
    if (!privateName.ok) assert.equal(privateName.reason, "resolved-private");

    const failed = await validateAdapterEndpoint("https://adapter.example/v1", {
      resolve: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.reason, "dns-failure");
  });

  it("classifies addresses and allows only same-host redirects", () => {
    assert.equal(forbiddenAddress("192.168.1.1"), "private");
    assert.equal(forbiddenAddress("224.0.0.1"), "multicast");
    assert.equal(forbiddenAddress("8.8.8.8"), undefined);
    assert.equal(forbiddenAddress("::ffff:10.0.0.1"), "private");

    assert.equal(redirectAllowed("https://a.example/v1", "https://a.example/v2"), true);
    assert.equal(redirectAllowed("https://a.example/v1", "https://b.example/v1"), false);
    assert.equal(redirectAllowed("https://a.example/v1", "http://a.example/v1"), false);
  });
});
