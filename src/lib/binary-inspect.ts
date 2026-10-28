import { createHash } from "node:crypto";

/**
 * What a `.bin` file contains, read without running anything.
 *
 * The console's own business is firmware releases, but the question a person
 * actually brings to a binary is broader than "is this a valid release": which chip
 * it was built for, when, with which IDF, whether it is an application at all, and —
 * for a full flash dump — every image inside it. So this reads the ESP image format
 * and nothing else, from bytes it never writes down.
 *
 * **Nothing here trusts the file.** Every length is checked against what is actually
 * left, every read is bounded, and a file that cannot be parsed is reported as
 * unparsed rather than repaired into something. The upload never reaches the
 * filesystem or the database: a binary someone is only looking at should not become
 * a release, and a parser that writes is a parser that can be made to.
 *
 * The format is ESP-IDF's `esp_image_format.h`: an 8-byte common header, an optional
 * 16-byte extended header (present on ESP32-S2 and later), one 8-byte header per
 * segment followed by that segment's data, a one-byte XOR checksum, and — when the
 * header says so — a SHA-256 of everything before it. The application descriptor is
 * a 256-byte structure at the start of the first segment: project, version, build
 * time, IDF version, ELF hash.
 */

export const INSPECT_LIMITS = {
  /** A full 16 MB flash dump is the largest thing this is for; leave room for 32. */
  maxBytes: 32 * 1024 * 1024,
  /** Images reported from one dump. A dump holds a handful, not dozens. */
  maxImages: 8,
  /** Segment headers an image may declare. The shipped builds use six. */
  maxSegments: 16,
  /** Partition entries read before the table is taken as read. */
  maxPartitions: 24,
  /** URLs shown, deduplicated in file order. */
  maxUrls: 50,
  maxUrlLength: 200,
  /** A text field from the descriptor, or a partition label. */
  maxTextLength: 64,
  /** Bytes shown as the file's opening signature. */
  firstBytes: 32,
} as const;

export type BinaryKind =
  | "esp-app"
  | "esp-bootloader"
  | "esp-flash-dump"
  | "esp-partition-table"
  | "elf"
  | "gzip"
  | "unknown";

export interface EspSegment {
  index: number;
  loadAddress: number;
  length: number;
  /** A coarse label from the load address: DROM, IROM, DRAM, IRAM, RTC. */
  type: string;
}

export interface EspAppDescription {
  project: string;
  version: string;
  time: string;
  date: string;
  idf: string;
  elfSha256: string;
  secureVersion: number;
}

export interface EspImage {
  /** Where in the file this image begins. */
  offset: number;
  kind: "app" | "bootloader";
  chipId: number | null;
  chip: string | null;
  entryPoint: number;
  flasMode: string;
  flashSize: string;
  flashFreq: string;
  segments: EspSegment[];
  /** Null when the first segment does not begin with an application descriptor. */
  app: EspAppDescription | null;
  /** True, false, or null where no checksum byte could be read. */
  checksumValid: boolean | null;
  /** True, false, or null where the image appends no hash. */
  hashValid: boolean | null;
  /** The image's span in the file, footer included. */
  bytes: number;
}

export interface PartitionEntry {
  label: string;
  type: number;
  subtype: number;
  offset: number;
  size: number;
}

export interface BinaryReport {
  kind: BinaryKind;
  size: number;
  sha256: string;
  firstBytes: string;
  images: EspImage[];
  partitions: PartitionEntry[] | null;
  /** Printable `http(s)` addresses in the file, deduplicated and capped. */
  urls: string[];
  /** What the parser could not make sense of, in the operator's words. */
  notes: string[];
}

const IMAGE_MAGIC = 0xe9;
const DESCRIPTOR_MAGIC = 0xabcd5432;
const PARTITION_MAGIC = 0x50aa;
const PARTITION_MD5_MAGIC = 0xebeb;

/** `esp_chip_id_t`, as the extended header carries it. */
const CHIPS: Record<number, string> = {
  0x0000: "ESP32",
  0x0002: "ESP32-S2",
  0x0005: "ESP32-C3",
  0x0009: "ESP32-S3",
  0x000c: "ESP32-C2",
  0x000d: "ESP32-C6",
  0x0010: "ESP32-H2",
  0x0012: "ESP32-P4",
  0x0014: "ESP32-C6 1",
  0x0017: "ESP32-C5",
};

const FLASH_SIZES = ["1 MB", "2 MB", "4 MB", "8 MB", "16 MB", "32 MB", "64 MB", "128 MB"];
const FLASH_FREQ: Record<number, string> = { 0x0: "40 MHz", 0x1: "26 MHz", 0x2: "20 MHz", 0xf: "80 MHz" };
const FLASH_MODES = ["QIO", "QOUT", "DIO", "DOUT"];

const u16le = (bytes: Uint8Array, at: number): number => bytes[at]! | (bytes[at + 1]! << 8);
const u32le = (bytes: Uint8Array, at: number): number =>
  (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;

/** A fixed-size C string, cut at its NUL and capped, decoded as ASCII with anything
 *  else replaced — a descriptor is the firmware's text, not a claim about encoding. */
function text(bytes: Uint8Array, at: number, length: number): string {
  let end = at;
  const limit = Math.min(at + length, bytes.length);
  while (end < limit && bytes[end] !== 0) end += 1;
  let out = "";
  for (let i = at; i < end && out.length < INSPECT_LIMITS.maxTextLength; i += 1) {
    const byte = bytes[i]!;
    out += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : "?";
  }
  return out;
}

function segmentType(loadAddress: number): string {
  if (loadAddress >= 0x50000000) return "RTC";
  if (loadAddress >= 0x42000000) return "IROM";
  if (loadAddress >= 0x40000000) return "IRAM";
  if (loadAddress >= 0x3f800000) return "DRAM";
  if (loadAddress >= 0x3c000000) return "DROM";
  return "unknown";
}

function readDescriptor(bytes: Uint8Array, at: number): EspAppDescription | null {
  if (at + 256 > bytes.length) return null;
  if (u32le(bytes, at) !== DESCRIPTOR_MAGIC) return null;
  return {
    secureVersion: u32le(bytes, at + 4),
    version: text(bytes, at + 16, 32),
    project: text(bytes, at + 48, 32),
    time: text(bytes, at + 80, 16),
    date: text(bytes, at + 96, 16),
    idf: text(bytes, at + 112, 32),
    elfSha256: hex(bytes.subarray(at + 144, at + 176)),
  };
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Walk one image's segment table, given where its header ends. Returns the parsed
 *  shape plus the offsets the checksum and hash are found at, or null when a length
 *  runs past the file — which is the only thing a malformed image has to do to be
 *  refused. */
function walkImage(
  bytes: Uint8Array,
  offset: number,
  headerLength: number
): { image: Omit<EspImage, "checksumValid" | "hashValid" | "app" | "kind">; afterSegments: number; data: Array<[number, number]> } | null {
  const count = bytes[offset + 1]!;
  if (count === 0 || count > INSPECT_LIMITS.maxSegments) return null;

  let at = offset + headerLength;
  const segments: EspSegment[] = [];
  const data: Array<[number, number]> = [];

  for (let index = 0; index < count; index += 1) {
    if (at + 8 > bytes.length) return null;
    const loadAddress = u32le(bytes, at);
    const length = u32le(bytes, at + 4);
    const start = at + 8;
    if (start + length > bytes.length) return null;
    segments.push({ index, loadAddress, length, type: segmentType(loadAddress) });
    data.push([start, length]);
    at = start + length;
  }

  if (at >= bytes.length) return null;

  const extended = headerLength === 24;
  const chipId = extended ? u16le(bytes, offset + 12) : null;
  const sizeAndSpeed = bytes[offset + 3]!;
  const mode = bytes[offset + 2]! & 0x03;

  return {
    image: {
      offset,
      chipId,
      chip: chipId === null ? null : (CHIPS[chipId] ?? `chip ${chipId}`),
      entryPoint: u32le(bytes, offset + 4),
      flasMode: FLASH_MODES[mode] ?? `mode ${mode}`,
      flashSize: FLASH_SIZES[sizeAndSpeed >> 4] ?? `${sizeAndSpeed >> 4}`,
      flashFreq: FLASH_FREQ[sizeAndSpeed & 0x0f] ?? `${sizeAndSpeed & 0x0f}`,
      segments,
      bytes: 0,
    },
    afterSegments: at,
    data,
  };
}

/** One candidate image, tried with the modern 24-byte header first and the classic
 *  8-byte one second. The parse that reaches a valid appended hash wins; failing
 *  that, the one whose segment table at least fits. */
function readImage(bytes: Uint8Array, offset: number): { image: EspImage; trailing: number } | null {
  if (offset + 8 > bytes.length || bytes[offset] !== IMAGE_MAGIC) return null;

  let fallback: { image: EspImage; trailing: number } | null = null;
  for (const headerLength of [24, 8]) {
    if (offset + headerLength > bytes.length) continue;
    const walked = walkImage(bytes, offset, headerLength);
    if (walked === null) continue;

    // The ROM's checksum starts at 0xEF and is XORed over the segment data. It is
    // written as the last byte of the 16-byte block the segments end in, with the
    // gap between them zero-filled — which is why it is not simply the next byte.
    let checksum = 0xef;
    for (const [start, length] of walked.data) {
      for (let i = start; i < start + length; i += 1) checksum ^= bytes[i]!;
    }
    const checksumAt = walked.afterSegments + (15 - (walked.afterSegments % 16));
    if (checksumAt >= bytes.length) continue;
    const checksumValid = checksum === bytes[checksumAt];

    // The appended digest covers everything from the start of the image through the
    // checksum byte. Its presence is the last byte of the 16-byte extended header;
    // a classic 8-byte header has no such field, and the digest is detected instead.
    const hashAt = checksumAt + 1;
    const hashAppended = headerLength === 24
      ? (bytes[offset + 23]! & 0x01) === 1
      : hashAt + 32 <= bytes.length;
    let hashValid: boolean | null = null;
    if (hashAt + 32 <= bytes.length) {
      const computed = createHash("sha256")
        .update(bytes.subarray(offset, hashAt))
        .digest();
      const stored = bytes.subarray(hashAt, hashAt + 32);
      const matches = computed.length === stored.length && computed.every((byte, i) => byte === stored[i]);
      hashValid = hashAppended ? matches : null;
    }

    const first = walked.data[0];
    const app = first === undefined ? null : readDescriptor(bytes, first[0]);
    const trailing = hashValid !== null && hashAppended ? hashAt + 32 : hashAt;
    const image: EspImage = {
      ...walked.image,
      kind: app === null ? "bootloader" : "app",
      app,
      checksumValid,
      hashValid,
      bytes: trailing - offset,
    };

    const candidate = { image, trailing };
    if (hashAppended && hashValid === true) return candidate;
    fallback ??= candidate;
  }
  return fallback;
}

/** The partition table, from `at`. Stops at the first entry that is not one, at the
 *  MD5 entry, or at the display cap — a table is read for what it says, not for how
 *  long a corrupt one claims to be. */
function readPartitions(bytes: Uint8Array, at: number): PartitionEntry[] | null {
  const entries: PartitionEntry[] = [];
  for (let index = 0; index < INSPECT_LIMITS.maxPartitions; index += 1) {
    const entry = at + index * 32;
    if (entry + 32 > bytes.length) break;
    const magic = u16le(bytes, entry);
    if (magic === PARTITION_MD5_MAGIC) break;
    if (magic !== PARTITION_MAGIC) break;
    entries.push({
      label: text(bytes, entry + 12, 16),
      type: bytes[entry + 2]!,
      subtype: bytes[entry + 3]!,
      offset: u32le(bytes, entry + 4),
      size: u32le(bytes, entry + 8),
    });
  }
  return entries.length === 0 ? null : entries;
}

/** Printable `http(s)` addresses, in file order, deduplicated and capped. Read off
 *  the raw bytes rather than a decoded copy: a 32 MB dump has no encoding to trust,
 *  and the addresses this is for are ASCII. */
function collectUrls(bytes: Uint8Array): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  let run = "";
  const flush = (): void => {
    if (run.length >= 8) {
      for (const match of run.matchAll(/https?:\/\/[^\s"'<>\\]+/g)) {
        const url = match[0].slice(0, INSPECT_LIMITS.maxUrlLength);
        if (!seen.has(url)) {
          seen.add(url);
          if (found.length < INSPECT_LIMITS.maxUrls) found.push(url);
        }
      }
    }
    run = "";
  };
  for (const byte of bytes) {
    if (byte >= 0x20 && byte <= 0x7e) {
      run += String.fromCharCode(byte);
      if (run.length > 4096) flush();
    } else {
      flush();
    }
  }
  flush();
  return found;
}

/** Every place a valid image begins: the file's own offset 0, the three offsets the
 *  ESP partition layout fixes, then every 64 KB boundary after that. Candidates are
 *  only parsed where the magic byte is present, which is what keeps a 32 MB scan
 *  cheap. */
function findImages(bytes: Uint8Array, notes: string[]): EspImage[] {
  const offsets = [0, 0x1000, 0x8000, 0x10000];
  for (let at = 0x20000; at + 8 <= bytes.length; at += 0x10000) offsets.push(at);

  const images: EspImage[] = [];
  const seen = new Set<number>();
  for (const offset of offsets) {
    if (images.length >= INSPECT_LIMITS.maxImages) break;
    if (offset + 8 > bytes.length) continue;
    if (bytes[offset] !== IMAGE_MAGIC) continue;
    const read = readImage(bytes, offset);
    if (read === null) {
      notes.push(`an image signature at 0x${offset.toString(16)} did not parse; it may be a fragment`);
      continue;
    }
    if (seen.has(read.image.offset)) continue;
    seen.add(read.image.offset);
    images.push(read.image);
  }
  return images;
}

/**
 * Read a file. Returns what it is and everything that can be said about it, and
 * never throws on malformed input: a file the parser cannot recognise is the answer
 * "unknown", with the reason in `notes`.
 */
export function inspectBinary(bytes: Uint8Array): BinaryReport {
  const notes: string[] = [];
  const images = findImages(bytes, notes);
  const at0 = images.find((image) => image.offset === 0);

  let partitions: PartitionEntry[] | null = null;
  if (bytes.length >= 0x8020) partitions = readPartitions(bytes, 0x8000);
  if (partitions === null && bytes.length >= 32) partitions = readPartitions(bytes, 0);

  // A dump's first image is its bootloader, so "an image at offset 0" is not enough
  // to call the file an application. What makes it a dump is another image past the
  // first, or a partition table beside one: a standalone bootloader has neither.
  const isDump = images.some((image) => image.offset > 0) || (partitions !== null && images.length > 0);

  let kind: BinaryKind;
  if (isDump) {
    kind = "esp-flash-dump";
  } else if (at0 !== undefined) {
    kind = at0.kind === "app" ? "esp-app" : "esp-bootloader";
  } else if (partitions !== null) {
    kind = "esp-partition-table";
  } else if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    kind = "elf";
  } else if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    kind = "gzip";
  } else {
    kind = "unknown";
  }

  if (kind === "esp-app" && at0 !== undefined) {
    if (at0.checksumValid === false) notes.push("the image's checksum does not match its contents");
    if (at0.hashValid === false) notes.push("the image's appended SHA-256 does not match its contents");
  }
  if (kind === "esp-bootloader") {
    notes.push("no application descriptor at the first segment: a bootloader, or a truncated application");
  }
  if (kind === "unknown" && bytes.length > 0) {
    notes.push("not an ESP image, an ELF file or a gzip archive");
  }
  if (kind === "esp-flash-dump") {
    notes.push(`${images.length} image(s) found; each is listed with its offset in the file`);
  }

  return {
    kind,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    firstBytes: hex(bytes.subarray(0, INSPECT_LIMITS.firstBytes)),
    images,
    partitions,
    urls: collectUrls(bytes),
    notes,
  };
}
