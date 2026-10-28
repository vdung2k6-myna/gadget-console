import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { INSPECT_LIMITS, inspectBinary } from "../src/lib/binary-inspect";

/**
 * Reading a binary that nobody has vouched for.
 *
 * The parser's contract is that every answer comes from the bytes: a valid image is
 * described down to its build and its IDF, and a file that is not one is said to be
 * unknown rather than repaired into something that looks plausible. The fixture is
 * built here rather than committed, because a 3.5 MB firmware image in the suite
 * would be a binary no one reviewing a test can read.
 */

function writeU16(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
}

function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = (value >>> 16) & 0xff;
  bytes[at + 3] = (value >>> 24) & 0xff;
}

function writeText(bytes: Uint8Array, at: number, length: number, value: string): void {
  for (let i = 0; i < value.length && i < length - 1; i += 1) bytes[at + i] = value.charCodeAt(i);
}

/**
 * One ESP32-S3 application image: 24-byte header, one DROM segment holding the app
 * descriptor and a little data, the XOR checksum, and the appended SHA-256 — the
 * same shape esptool reports for the build on the board.
 */
function image({
  descriptor = true,
  chipId = 9,
  project = "xiaozhi",
  version = "2.2.3",
}: {
  descriptor?: boolean;
  chipId?: number;
  project?: string;
  version?: string;
} = {}): Uint8Array {
  const descriptorLength = 256;
  const payload = 8;
  const segmentAt = 24;
  const dataAt = segmentAt + 8;
  const segmentLength = descriptorLength + payload;
  const afterSegments = dataAt + segmentLength;
  // The checksum is the last byte of the 16-byte block the segments end in, so the
  // gap before it is zero padding.
  const checksumAt = afterSegments + (15 - (afterSegments % 16));
  const bytes = new Uint8Array(checksumAt + 1 + 32);

  bytes[0] = 0xe9;
  bytes[1] = 1;
  bytes[2] = 2; // DIO
  bytes[3] = 0x4f; // 16 MB, 80 MHz
  writeU32(bytes, 4, 0x40379728);
  bytes[8] = 0xee; // WP pin disabled
  writeU16(bytes, 12, chipId);
  bytes[23] = 1; // hash appended: the last byte of the extended header

  writeU32(bytes, segmentAt, 0x3c220020);
  writeU32(bytes, segmentAt + 4, segmentLength);

  if (descriptor) {
    writeU32(bytes, dataAt, 0xabcd5432);
    writeText(bytes, dataAt + 16, 32, version);
    writeText(bytes, dataAt + 48, 32, project);
    writeText(bytes, dataAt + 80, 16, "15:28:03");
    writeText(bytes, dataAt + 96, 16, "Oct 20 2026");
    writeText(bytes, dataAt + 112, 32, "v5.5.2");
    for (let i = 0; i < 32; i += 1) bytes[dataAt + 144 + i] = i;
  }
  for (let i = 0; i < payload; i += 1) bytes[dataAt + descriptorLength + i] = 0x11 + i;

  let checksum = 0xef;
  for (let i = dataAt; i < afterSegments; i += 1) checksum ^= bytes[i]!;
  bytes[checksumAt] = checksum;
  const hash = createHash("sha256").update(bytes.subarray(0, checksumAt + 1)).digest();
  bytes.set(hash, checksumAt + 1);
  return bytes;
}

describe("reading a binary", () => {
  it("describes an application image, its chip and its build", () => {
    const report = inspectBinary(image());
    assert.equal(report.kind, "esp-app");
    assert.equal(report.sha256.length, 64);
    assert.equal(report.firstBytes.length, INSPECT_LIMITS.firstBytes * 2);

    const found = report.images[0]!;
    assert.equal(found.kind, "app");
    assert.equal(found.chip, "ESP32-S3");
    assert.equal(found.chipId, 9);
    assert.equal(found.entryPoint, 0x40379728);
    assert.equal(found.flashSize, "16 MB");
    assert.equal(found.flashFreq, "80 MHz");
    assert.equal(found.flasMode, "DIO");
    assert.equal(found.segments.length, 1);
    assert.equal(found.segments[0]!.type, "DROM");
    assert.equal(found.checksumValid, true);
    assert.equal(found.hashValid, true);

    assert.equal(found.app?.project, "xiaozhi");
    assert.equal(found.app?.version, "2.2.3");
    assert.equal(found.app?.date, "Oct 20 2026");
    assert.equal(found.app?.time, "15:28:03");
    assert.equal(found.app?.idf, "v5.5.2");
    assert.equal(found.app?.elfSha256.length, 64);
  });

  it("calls an image with no application descriptor a bootloader", () => {
    const report = inspectBinary(image({ descriptor: false }));
    assert.equal(report.kind, "esp-bootloader");
    assert.equal(report.images[0]?.app, null);
    assert.ok(report.notes.some((note) => note.includes("bootloader")));
  });

  it("finds every image in a full flash dump, bootloader included", () => {
    // A dump starts with a bootloader, which is also a valid image — so the file is
    // a dump because something follows it, not because an image sits at offset 0.
    const dump = new Uint8Array(0x2000);
    dump.set(image({ descriptor: false }), 0);
    dump.set(image(), 0x1000);
    const report = inspectBinary(dump);
    assert.equal(report.kind, "esp-flash-dump");
    assert.equal(report.images.length, 2);
    assert.deepEqual(report.images.map((found) => found.offset), [0, 0x1000]);
    assert.equal(report.images[0]!.kind, "bootloader");
    assert.equal(report.images[1]!.app?.version, "2.2.3");
  });

  it("reads a partition table", () => {
    const table = new Uint8Array(0x8040);
    const at = 0x8000;
    writeU16(table, at, 0x50aa);
    table[at + 2] = 1; // data
    table[at + 3] = 2; // nvs
    writeU32(table, at + 4, 0x9000);
    writeU32(table, at + 8, 0x6000);
    writeText(table, at + 12, 16, "nvs");
    writeU16(table, at + 32, 0xebeb); // the MD5 entry ends the table

    const report = inspectBinary(table);
    assert.equal(report.kind, "esp-partition-table");
    assert.deepEqual(report.partitions, [
      { label: "nvs", type: 1, subtype: 2, offset: 0x9000, size: 0x6000 },
    ]);
  });

  it("collects addresses from otherwise unreadable bytes, once each", () => {
    const text = new TextEncoder().encode(
      "junk https://a.example/one?x=1 junk https://a.example/one?x=1 and https://b.example/two"
    );
    const report = inspectBinary(text);
    assert.equal(report.kind, "unknown");
    assert.deepEqual(report.urls, ["https://a.example/one?x=1", "https://b.example/two"]);
  });

  it("reports a checksum that does not match its contents", () => {
    const bytes = image();
    bytes[32 + 256 + 2] = 0xff; // a byte of the segment's payload, not its descriptor
    const report = inspectBinary(bytes);
    assert.equal(report.images[0]?.checksumValid, false);
    assert.ok(report.notes.some((note) => note.includes("checksum")));
  });

  it("refuses to guess at a truncated image", () => {
    const report = inspectBinary(image().subarray(0, 20));
    assert.equal(report.kind, "unknown");
    assert.equal(report.images.length, 0);
  });

  it("knows an ELF when it sees one", () => {
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]);
    assert.equal(inspectBinary(elf).kind, "elf");
  });
});
