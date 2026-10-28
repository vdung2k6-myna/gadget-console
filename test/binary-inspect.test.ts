import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  INSPECT_LIMITS,
  extractImage,
  findStrings,
  inspectBinary,
  patchAddress,
  patchImage,
  patchString,
} from "../src/lib/binary-inspect";

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
  payload = "",
}: {
  descriptor?: boolean;
  chipId?: number;
  project?: string;
  version?: string;
  payload?: string;
} = {}): Uint8Array {
  const descriptorLength = 256;
  const payloadBytes = new TextEncoder().encode(payload);
  const payloadLength = Math.max(8, payloadBytes.length);
  const segmentAt = 24;
  const dataAt = segmentAt + 8;
  const segmentLength = descriptorLength + payloadLength;
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
  if (payloadBytes.length > 0) {
    bytes.set(payloadBytes, dataAt + descriptorLength);
  } else {
    for (let i = 0; i < payloadLength; i += 1) bytes[dataAt + descriptorLength + i] = 0x11 + i;
  }

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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** An image with a Secure Boot v2 signature sector: one block at the sector's start,
 *  magic and version set, CRC over the block's data. The key material is zero — the
 *  inspector does not verify the signature, only that a block is there. */
function withSignature(input: Uint8Array, version = 2): Uint8Array {
  const out = new Uint8Array(input.length + 4096);
  out.set(input, 0);
  const at = input.length;
  out[at] = 0xe7;
  out[at + 1] = version;
  writeU32(out, at + 1196, crc32(out.subarray(at, at + 1196)));
  return out;
}

describe("a signed image", () => {
  it("reports its signature and counts the sector as part of the image", () => {
    const signed = withSignature(image());
    const report = inspectBinary(signed);
    assert.deepEqual(report.images[0]?.signature, { kind: "rsa", blocks: 1 });
    assert.equal(report.images[0]?.bytes, signed.length);
  });

  it("reads an ECDSA block", () => {
    assert.deepEqual(inspectBinary(withSignature(image(), 3)).images[0]?.signature, {
      kind: "ecdsa",
      blocks: 1,
    });
  });

  it("does not mistake padding for a signature", () => {
    const out = new Uint8Array(image().length + 4096);
    out.set(image(), 0);
    out[out.length - 4096] = 0xe7; // magic alone, with no version and no CRC
    assert.equal(inspectBinary(out).images[0]?.signature, null);
  });

  it("keeps the signature sector when the image is extracted", () => {
    const signed = withSignature(image());
    assert.deepEqual(extractImage(signed, 0), signed);
  });

  it("marks a patch as leaving the old signature behind", () => {
    const signed = withSignature(image());
    const result = patchImage(signed, 0, "2.2.3", "2.2.4");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.signatureInvalidated, true);
    assert.equal(result.bytes.length, signed.length);
    assert.deepEqual(
      result.bytes.subarray(result.bytes.length - 4096),
      signed.subarray(signed.length - 4096),
      "the old signature sector is left where it was, for a re-sign to be appended after"
    );

    const report = inspectBinary(result.bytes);
    assert.equal(report.images[0]?.app?.version, "2.2.4");
    assert.equal(report.images[0]?.hashValid, true);
  });

  it("does not mark an unsigned image's patch", () => {
    const result = patchImage(image(), 0, "2.2.3", "2.2.4");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.signatureInvalidated, false);
  });
});

describe("changing a binary", () => {
  it("replaces a string and leaves an image that still validates", () => {
    const source = image();
    const result = patchImage(source, 0, "2.2.3", "2.2.4");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.occurrences, 1);
    assert.equal(result.bytes.length, source.length);

    const report = inspectBinary(result.bytes);
    assert.equal(report.kind, "esp-app");
    assert.equal(report.images[0]?.app?.version, "2.2.4");
    assert.equal(report.images[0]?.checksumValid, true);
    assert.equal(report.images[0]?.hashValid, true);
  });

  it("pads a shorter replacement with NULs", () => {
    const result = patchImage(image(), 0, "xiaozhi", "xiaoz");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const report = inspectBinary(result.bytes);
    assert.equal(report.images[0]?.app?.project, "xiaoz");
    assert.equal(report.images[0]?.checksumValid, true);
    assert.equal(report.images[0]?.hashValid, true);
  });

  it("refuses a longer replacement rather than moving the segment", () => {
    assert.deepEqual(patchImage(image(), 0, "xiaozhi", "xiaozhi2"), {
      ok: false,
      reason: "longer",
    });
  });

  it("refuses a string that is not there", () => {
    assert.deepEqual(patchImage(image(), 0, "not-in-this-image", "x"), {
      ok: false,
      reason: "not-found",
    });
  });

  it("patches an image inside a dump without touching what precedes it", () => {
    const dump = new Uint8Array(0x2000);
    dump.set(image({ descriptor: false }), 0);
    dump.set(image(), 0x1000);

    const result = patchImage(dump, 0x1000, "2.2.3", "2.2.9");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(result.bytes.subarray(0, 0x1000), dump.subarray(0, 0x1000));
    const report = inspectBinary(result.bytes);
    assert.equal(report.kind, "esp-flash-dump");
    assert.equal(report.images[0]?.kind, "bootloader");
    assert.equal(report.images[1]?.app?.version, "2.2.9");
    assert.equal(report.images[1]?.checksumValid, true);
    assert.equal(report.images[1]?.hashValid, true);
  });

  it("extracts one image out of a dump", () => {
    const dump = new Uint8Array(0x2000);
    const app = image();
    dump.set(app, 0x1000);

    const extracted = extractImage(dump, 0x1000);
    assert.deepEqual(extracted, app);
    assert.equal(inspectBinary(extracted!).kind, "esp-app");
  });
});

describe("editing a whole string", () => {
  const url = "https://chat.example.com/xiaozhi/ota/";
  /** Two copies of the URL inside the segment's C-string area, which is what makes
   *  the difference between editing one value and editing every occurrence of it. */
  const withUrl = (): Uint8Array =>
    image({ payload: `prefix\u0000${url}\u0000${url}\u0000tail` });

  it("finds the whole string around the query, once per value", () => {
    assert.deepEqual(
      findStrings(withUrl(), 0, "example").map((entry) => entry.value),
      [url]
    );
  });

  it("refuses to replace a fragment in the middle of a string", () => {
    assert.deepEqual(patchString(withUrl(), 0, "example", "x"), {
      ok: false,
      reason: "not-found",
    });
  });

  it("replaces every copy of the whole string, and the result reads correctly", () => {
    const replacement = "https://chat.example.com/xiaozhi/ota/";
    const result = patchString(withUrl(), 0, url, replacement);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.occurrences, 2);
    assert.deepEqual(
      findStrings(result.bytes, 0, "chat.example").map((entry) => entry.value),
      [replacement],
      "the value ends where the replacement ends, not at a NUL in the middle of it"
    );

    const report = inspectBinary(result.bytes);
    assert.equal(report.images[0]?.checksumValid, true);
    assert.equal(report.images[0]?.hashValid, true);
  });

  it("refuses a whole string that is longer than the original", () => {
    assert.deepEqual(patchString(withUrl(), 0, url, `${url}x`), {
      ok: false,
      reason: "longer",
    });
  });

  it("offers nothing for an empty query", () => {
    assert.deepEqual(findStrings(withUrl(), 0, ""), []);
  });
});

describe("editing an address", () => {
  const url = "http://www.w3.org/2000/svg";

  it("replaces an address inside markup and pads the gap with spaces", () => {
    const source = image({ payload: `<svg xmlns="${url}"><rect/></svg>` });
    const result = patchAddress(source, url, "http://example.com/svg");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const payload = new TextDecoder().decode(result.bytes.subarray(32 + 256));
    assert.ok(
      payload.includes('http://example.com/svg    "'),
      "the four bytes the shorter address left are spaces, which HTML tolerates"
    );

    const report = inspectBinary(result.bytes);
    assert.equal(report.images[0]?.checksumValid, true);
    assert.equal(report.images[0]?.hashValid, true);
  });

  it("pads with a NUL when the address was a C string", () => {
    const cUrl = "https://chat.example.com/xiaozhi/ota/";
    const source = image({ payload: `prefix\u0000${cUrl}\u0000tail` });
    const result = patchAddress(source, cUrl, "https://chat.example.com/xiaozhi/ota/");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.deepEqual(
      findStrings(result.bytes, 0, "chat.example").map((entry) => entry.value),
      ["https://chat.example.com/xiaozhi/ota/"]
    );
  });

  it("refuses an address that is not inside any image", () => {
    const bytes = new TextEncoder().encode(`just a file ${url}`);
    assert.deepEqual(patchAddress(bytes, url, "http://example.com/svg"), {
      ok: false,
      reason: "not-found",
    });
  });

  it("refuses a longer address", () => {
    assert.deepEqual(patchAddress(image({ payload: url }), url, `${url}/x`), {
      ok: false,
      reason: "longer",
    });
  });

  it("refuses an address found in more than one image", () => {
    const dump = new Uint8Array(0x2000);
    dump.set(image({ payload: url }), 0);
    dump.set(image({ payload: url }), 0x1000);
    assert.deepEqual(patchAddress(dump, url, "http://example.com/svg"), {
      ok: false,
      reason: "ambiguous",
    });
  });
});
