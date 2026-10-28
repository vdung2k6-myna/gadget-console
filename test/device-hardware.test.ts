import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import {
  HARDWARE_LIMITS,
  publicHardware,
  recordDeviceHardware,
  validateHardwareReport,
} from "../src/lib/device-hardware";
import { publicDevice } from "../src/lib/devices";
import { devices } from "../src/lib/db/schema";

before(() => requireTestDatabase());
beforeEach(resetDb);
after(closeDb);

const MAC = "b8:1f:3f:4a:9b:01";
const STORED = "b81f3f4a9b01";

/** What the firmware's OTA body looks like once it has been narrowed to the allowlist. */
const REPORT = {
  board: { type: "esp-box-3", name: "ESP32-S3-BOX-3", manufacturer: "espressif" },
  chip: "esp32s3",
  flashSize: 16_777_216,
  psramSize: 8_388_608,
  display: { width: 320, height: 240, monochrome: false },
  application: { name: "xiaozhi", version: "1.2.3" },
  language: "vi",
};

async function device() {
  const account = await registerAccount("ann@example.com", "a good password");
  if (!account.ok) throw new Error("could not register");
  const rows = await getDb()
    .insert(devices)
    .values({ deviceId: STORED, userId: account.user.id, secret: "s".repeat(32) })
    .returning();
  return rows[0]!;
}

describe("validating a hardware report", () => {
  it("takes the report the firmware sends", () => {
    const result = validateHardwareReport(REPORT);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.hardware, REPORT);
  });

  it("keeps an absent field absent rather than filling it", () => {
    const result = validateHardwareReport({
      board: { type: "bread-compact-wifi-lcd" },
      chip: "esp32s3",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.hardware, {
      board: { type: "bread-compact-wifi-lcd" },
      chip: "esp32s3",
    });
    assert.equal("psramSize" in result.hardware, false);
    assert.equal("display" in result.hardware, false);
  });

  it("trims a value instead of storing the whitespace", () => {
    const result = validateHardwareReport({ board: { type: "  esp-box-3  " }, chip: " x " });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.hardware.board?.type, "esp-box-3");
    assert.equal(result.hardware.chip, "x");
  });

  it("refuses the whole report when any field is outside the shape", () => {
    assert.equal(validateHardwareReport({ ...REPORT, chip: 42 }).ok, false);
    assert.equal(validateHardwareReport({ ...REPORT, flashSize: -1 }).ok, false);
    assert.equal(validateHardwareReport({ ...REPORT, flashSize: 1.5 }).ok, false);
    assert.equal(validateHardwareReport({ ...REPORT, flashSize: 2 ** 41 }).ok, false);
    assert.equal(validateHardwareReport({ ...REPORT, display: { width: 0 } }).ok, false);
    assert.equal(
      validateHardwareReport({ ...REPORT, display: { width: 320, monochrome: "yes" } }).ok,
      false
    );
    assert.equal(
      validateHardwareReport({ ...REPORT, board: { type: "x".repeat(HARDWARE_LIMITS.maxString + 1) } })
        .ok,
      false
    );
    assert.equal(validateHardwareReport({ ...REPORT, board: { type: "" } }).ok, false);
  });

  it("refuses a field the allowlist does not know", () => {
    assert.equal(validateHardwareReport({ ...REPORT, serialNumber: "abc" }).ok, false);
    assert.equal(validateHardwareReport({ ...REPORT, board: { type: "x", pins: [1] } }).ok, false);
  });

  it("refuses a report carrying identifiers or internal detail", () => {
    for (const extra of [
      { mac_address: "b8:1f:3f:4a:9b:01" },
      { uuid: "00000000-0000-0000-0000-000000000000" },
      { imei: "123456789012345" },
      { iccid: "89860000000000000000" },
      { ip: "192.168.1.20" },
      { partition_table: [] },
      { elf_sha256: "abc" },
      { application: { name: "xiaozhi", version: "1.2.3", elf_sha256: "abc" } },
    ]) {
      assert.equal(validateHardwareReport({ ...REPORT, ...extra }).ok, false, JSON.stringify(extra));
    }
  });

  it("refuses an empty report, a body that is not an object, and a report with too many fields", () => {
    assert.equal(validateHardwareReport({}).ok, false);
    assert.equal(validateHardwareReport(null).ok, false);
    assert.equal(validateHardwareReport([]).ok, false);
    assert.equal(validateHardwareReport("board").ok, false);

    const many = Object.fromEntries(
      Array.from({ length: HARDWARE_LIMITS.maxKeys + 1 }, (_, index) => [`field${index}`, "x"])
    );
    assert.equal(validateHardwareReport(many).ok, false);
  });
});

describe("what a browser is shown", () => {
  it("returns the narrowed report", () => {
    assert.deepEqual(publicHardware(REPORT), REPORT);
  });

  it("drops a key the projection does not know", () => {
    const stored = { ...REPORT, serialNumber: "abc" } as unknown as typeof REPORT;
    assert.equal(publicHardware(stored), null);
    assert.equal(JSON.stringify(publicHardware(stored)).includes("serialNumber"), false);
  });

  it("answers null when nothing was reported", () => {
    assert.equal(publicHardware(null), null);
    assert.equal(publicHardware(undefined), null);
  });

  it("is what a public device carries, with no identifier from the raw body", () => {
    const row = {
      id: "row",
      deviceId: STORED,
      userId: null,
      name: "",
      secret: "s",
      agentId: null,
      partnerDeviceId: null,
      lastSeenAt: null,
      tools: null,
      toolsReportedAt: null,
      hardware: { ...REPORT, imei: "123456789012345" },
      hardwareReportedAt: new Date(),
      createdAt: new Date(),
    } as unknown as typeof devices.$inferSelect;

    const shown = publicDevice(row);
    assert.equal(shown.hardware, null);
    assert.equal("secret" in shown, false);
  });
});

describe("recording a report", () => {
  it("stores it against the device the bridge named, however the identifier was written", async () => {
    const created = await device();
    assert.equal(await recordDeviceHardware("B8-1F-3F-4A-9B-01", REPORT), true);

    const rows = await getDb().select().from(devices);
    assert.equal(rows[0]?.id, created.id);
    assert.deepEqual(rows[0]?.hardware, REPORT);
    assert.ok(rows[0]?.hardwareReportedAt instanceof Date);
  });

  it("answers false for a device it does not know", async () => {
    assert.equal(await recordDeviceHardware("aa:bb:cc:dd:ee:ff", REPORT), false);
  });

  it("leaves the stored report standing when a later report is refused", async () => {
    await device();
    await recordDeviceHardware(MAC, REPORT);

    const refused = validateHardwareReport({ ...REPORT, chip: 42 });
    assert.equal(refused.ok, false);

    const rows = await getDb().select().from(devices);
    assert.deepEqual(rows[0]?.hardware, REPORT);
  });
});
