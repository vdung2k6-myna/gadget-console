import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { TOOL_LIMITS, recordDeviceTools, validateToolReport } from "../src/lib/device-tools";
import { devices } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

const MAC = "b8:1f:3f:4a:9b:01";
/** A device is stored normalized — the bridge and the claim both normalize first. */
const STORED = "b81f3f4a9b01";

async function device() {
  const account = await registerAccount("ann@example.com", "a good password");
  if (!account.ok) throw new Error("could not register");
  const rows = await getDb()
    .insert(devices)
    .values({ deviceId: STORED, userId: account.user.id, secret: "s".repeat(32) })
    .returning();
  return rows[0]!;
}

function report(tools: unknown) {
  return { deviceId: MAC, tools };
}

describe("validating a catalogue", () => {
  it("accepts what the firmware writes", () => {
    const result = validateToolReport(
      report([{ name: "self.audio_speaker.set_volume", description: "Set the volume." }])
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.tools[0]?.name, "self.audio_speaker.set_volume");
  });

  it("accepts an empty catalogue, which is a fact rather than a miss", () => {
    const result = validateToolReport(report([]));
    assert.deepEqual(result, { ok: true, tools: [] });
  });

  it("refuses the whole report when any bound is exceeded", () => {
    const tooMany = Array.from({ length: TOOL_LIMITS.maxTools + 1 }, (_, index) => ({
      name: `tool.${index}`,
      description: "d",
    }));
    assert.equal(validateToolReport(report(tooMany)).ok, false);

    const longName = [{ name: "n".repeat(TOOL_LIMITS.maxName + 1), description: "d" }];
    assert.equal(validateToolReport(report(longName)).ok, false);

    const longDescription = [
      { name: "n", description: "d".repeat(TOOL_LIMITS.maxDescription + 1) },
    ];
    assert.equal(validateToolReport(report(longDescription)).ok, false);
  });

  it("refuses a missing name, a missing description, and a body that is not a catalogue", () => {
    assert.equal(validateToolReport(report([{ description: "d" }])).ok, false);
    assert.equal(validateToolReport(report([{ name: "n" }])).ok, false);
    assert.equal(validateToolReport({ deviceId: MAC }).ok, false);
    assert.equal(validateToolReport(null).ok, false);
  });
});

describe("recording a catalogue", () => {
  it("stores it against the device the bridge named, however the identifier was written", async () => {
    await device();
    assert.equal(
      await recordDeviceTools("B8-1F-3F-4A-9B-01", [
        { name: "self.screen.set_brightness", description: "Set the brightness." },
      ]),
      true
    );

    const rows = await getDb().select().from(devices).where(eq(devices.deviceId, "b81f3f4a9b01"));
    assert.equal(rows[0]?.tools?.length, 1);
    assert.ok(rows[0]?.toolsReportedAt instanceof Date);
  });

  it("records an empty catalogue as empty, not as unknown", async () => {
    await device();
    assert.equal(await recordDeviceTools(MAC, []), true);

    const rows = await getDb().select().from(devices);
    assert.deepEqual(rows[0]?.tools, []);
    assert.ok(rows[0]?.toolsReportedAt instanceof Date);
  });

  it("answers false for a device it does not know", async () => {
    assert.equal(await recordDeviceTools("aa:bb:cc:dd:ee:ff", []), false);
  });

  it("leaves the stored catalogue standing when a later report is refused", async () => {
    await device();
    await recordDeviceTools(MAC, [{ name: "keep.me", description: "still here" }]);

    const refused = validateToolReport(report([{ name: "n".repeat(TOOL_LIMITS.maxName + 1) }]));
    assert.equal(refused.ok, false);

    const rows = await getDb().select().from(devices);
    assert.equal(rows[0]?.tools?.[0]?.name, "keep.me");
  });
});
