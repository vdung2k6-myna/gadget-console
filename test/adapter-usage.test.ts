import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { accountWithTenant, tenantOfUser } from "./helpers/tenant";
import { ownDevice } from "./helpers/own";
import { listTenantEgress, tenantUsageReport } from "../src/lib/adapter-egress";
import { createAdapter } from "../src/lib/adapters";
import { tenants } from "../src/lib/db/schema";
import { usageReport } from "../src/lib/tenancy/usage";
import { POST as usageRoute } from "../src/app/api/bridge/usage/route";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

const MAC = "B8:1F:3F:4A:9B:11";

function report(deviceId: string, events: unknown[], authorization?: string): Request {
  return new Request("http://console.test/api/bridge/usage", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify({ deviceId, events }),
  });
}

function events(adapterId: string) {
  return [
    {
      kind: "llm",
      adapterId,
      status: "ok",
      latencyMs: 123,
      bytes: 456,
      inputTokens: 10,
      outputTokens: 4,
    },
  ];
}

describe("the bridge's adapter usage report", () => {
  it("records what the runtime observed against the device's tenant", async () => {
    const ann = await accountWithTenant("ann@example.com");
    const device = await ownDevice(ann.id, MAC);
    const issued = await createAdapter(await tenantOfUser(ann.id), {
      name: "acme",
      endpoint: "https://acme.example/v1",
      kinds: ["llm"],
    });

    const response = await usageRoute(
      report(device.deviceId, events(issued.adapter.id), `Bearer ${process.env.BRIDGE_TOKEN}`)
    );
    assert.equal(response.status, 204);

    const rows = await listTenantEgress(await tenantOfUser(ann.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.adapterId, issued.adapter.id);
    assert.equal(rows[0]?.kind, "llm");
    assert.equal(rows[0]?.status, "ok");
    assert.equal(rows[0]?.latencyMs, 123);
    assert.equal(rows[0]?.bytes, 456);
    assert.equal(
      JSON.stringify(rows[0]).includes("tokens"),
      false,
      "only the observed size is stored, not a transcript"
    );
  });

  it("separates platform speech from reseller speech in the report", async () => {
    const ann = await accountWithTenant("ann@example.com");
    const device = await ownDevice(ann.id, MAC);
    const tenantId = await tenantOfUser(ann.id);
    const issued = await createAdapter(tenantId, {
      name: "acme",
      endpoint: "https://acme.example/v1",
      kinds: ["tts"],
    });

    const response = await usageRoute(
      report(
        device.deviceId,
        [
          {
            kind: "tts",
            adapterId: null,
            status: "ok",
            latencyMs: 10,
            bytes: 100,
            audioSeconds: 2,
          },
          {
            kind: "tts",
            adapterId: issued.adapter.id,
            status: "ok",
            latencyMs: 20,
            bytes: 200,
            audioSeconds: 3,
          },
        ],
        `Bearer ${process.env.BRIDGE_TOKEN}`
      )
    );
    assert.equal(response.status, 204);

    const aggregate = await tenantUsageReport(tenantId);
    assert.equal(aggregate.calls, 2);
    assert.equal(aggregate.bytes, 300);
    assert.equal(aggregate.audioSeconds, 5);
    assert.equal(aggregate.platformSpeechSeconds, 2, "the platform's own speech is billed");
    assert.equal(aggregate.resellerSpeechSeconds, 3, "reseller speech is recorded, not billed");

    // The billing meter reads the same observation: no adapter id is platform
    // speech, an adapter id is reseller speech.
    const meter = await usageReport(tenantId, { since: new Date(Date.now() - 3_600_000) });
    assert.equal(meter.platformSeconds, 2);
    assert.equal(meter.resellerSeconds, 3);
    assert.equal(meter.billableSeconds, 2, "with no allowance, platform speech is overage");
  });

  it("records fractional audio observations as whole seconds per call", async () => {
    const ann = await accountWithTenant("ann@example.com");
    const device = await ownDevice(ann.id, MAC);
    const tenantId = await tenantOfUser(ann.id);

    const response = await usageRoute(
      report(
        device.deviceId,
        [
          { kind: "tts", adapterId: null, status: "ok", audioSeconds: 1.4 },
          { kind: "tts", adapterId: null, status: "ok", audioSeconds: 1.6 },
        ],
        `Bearer ${process.env.BRIDGE_TOKEN}`
      )
    );
    assert.equal(response.status, 204);

    const meter = await usageReport(tenantId, { since: new Date(Date.now() - 3_600_000) });
    assert.equal(meter.platformSeconds, 3, "1.4 rounds to 1 and 1.6 rounds to 2");
  });

  it("files nothing for another tenant", async () => {
    const ann = await accountWithTenant("ann@example.com");
    const device = await ownDevice(ann.id, MAC);
    const issued = await createAdapter(await tenantOfUser(ann.id), {
      name: "acme",
      endpoint: "https://acme.example/v1",
      kinds: ["llm"],
    });
    const rows = await getDb()
      .insert(tenants)
      .values({ name: "Other", slug: "other" })
      .returning();

    await usageRoute(
      report(device.deviceId, events(issued.adapter.id), `Bearer ${process.env.BRIDGE_TOKEN}`)
    );

    assert.deepEqual(await listTenantEgress(rows[0]!.id), []);
  });

  it("refuses a report without the bridge credential", async () => {
    const ann = await accountWithTenant("ann@example.com");
    const device = await ownDevice(ann.id, MAC);
    const issued = await createAdapter(await tenantOfUser(ann.id), {
      name: "acme",
      endpoint: "https://acme.example/v1",
      kinds: ["llm"],
    });

    const response = await usageRoute(report(device.deviceId, events(issued.adapter.id)));
    assert.equal(response.status, 401);
    assert.deepEqual(await listTenantEgress(await tenantOfUser(ann.id)), []);
  });

  it("refuses a report for a device it does not know", async () => {
    const response = await usageRoute(
      report(
        "unknown-device",
        events("00000000-0000-4000-8000-000000000000"),
        `Bearer ${process.env.BRIDGE_TOKEN}`
      )
    );
    assert.equal(response.status, 404);
  });
});
