import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq } from "drizzle-orm";
import { recordFirmwareAction } from "@/lib/admin";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { firmwareReleases, users } from "@/lib/db/schema";

/**
 * Firmware images the console keeps, and which one a board type should run.
 *
 * The row is the promise and the file under `FIRMWARE_DIR` is the payload; the
 * row's id is the file's name, so a row without a file is a release that cannot be
 * served and a file without a row is never referenced. An upload is written under a
 * temporary name and renamed only after its row is committed, so a failed write
 * leaves neither a half image nor a row pointing at one.
 *
 * Two rules are enforced here rather than left to a route:
 *
 * **One target per board type.** The database carries a partial unique index, and
 * the target move is a transaction that clears the old target first.
 *
 * **A targeted release cannot be deleted.** Deleting it would leave a target
 * pointing at nothing, and the failure would be silent. Clear or replace the target
 * first; both acts are audited.
 *
 * The console does not order versions. `forced` is an admin's deliberate statement
 * that a release may be installed even when the firmware would call it older; the
 * firmware makes that decision, and the console only carries it.
 */

export const FIRMWARE_LIMITS = {
  /** An ESP application image starts with this byte. */
  espImageMagic: 0xe9,
  maxTextLength: 64,
} as const;

/** Board identities the firmware uses: `esp-box-3`, `bread-compact-wifi-lcd`. */
const BOARD_TYPE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
/** A version the image itself reports; no spaces, because the firmware compares strings. */
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

export type FirmwareRelease = typeof firmwareReleases.$inferSelect;

export interface FirmwareUpload {
  boardType: string;
  version: string;
  bytes: Uint8Array;
}

export type FirmwareValidation =
  | { ok: true; boardType: string; version: string; bytes: Uint8Array }
  | { ok: false; errors: string[] };

export function validateFirmwareUpload(input: unknown): FirmwareValidation {
  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["an upload must be an object"] };
  }
  const { boardType, version, bytes } = input as {
    boardType?: unknown;
    version?: unknown;
    bytes?: unknown;
  };
  const errors: string[] = [];

  const normalizedBoard = typeof boardType === "string" ? boardType.trim() : "";
  if (!BOARD_TYPE.test(normalizedBoard)) {
    errors.push("boardType must look like esp-box-3");
  }
  const normalizedVersion = typeof version === "string" ? version.trim() : "";
  if (!VERSION.test(normalizedVersion)) {
    errors.push("version is required and carries no spaces");
  }

  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    errors.push("the image is empty");
  } else {
    const max = loadConfig().firmwareMaxBytes;
    if (bytes.length > max) errors.push(`the image is larger than ${max} bytes`);
    if (bytes[0] !== FIRMWARE_LIMITS.espImageMagic) {
      errors.push("the file is not an ESP application image");
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  // The image branch above is the only way past the errors check.
  return { ok: true, boardType: normalizedBoard, version: normalizedVersion, bytes: bytes as Uint8Array };
}

export type FirmwareDirectory =
  | { path: string }
  | { problem: "unset" | "inside-public" };

/**
 * The configured directory, resolved once and checked against the one path the web
 * server serves without this route: `public`.
 *
 * An image there would also be returned by the static handler, bypassing the length
 * and size checks this console applies, and anything else placed there would be
 * readable too. A refusal is a stated problem rather than a fallback, because a
 * silent move to another directory is where an image nobody backs up would live.
 */
export function firmwareDirectory(): FirmwareDirectory {
  const configured = loadConfig().firmwareDir;
  if (configured === null) return { problem: "unset" };

  const directory = path.resolve(configured);
  const publicRoot = path.resolve(process.cwd(), "public");
  if (directory === publicRoot || directory.startsWith(publicRoot + path.sep)) {
    return { problem: "inside-public" };
  }
  return { path: directory };
}

export type StoreResult =
  | { ok: true; release: FirmwareRelease }
  | {
      ok: false;
      reason: "invalid" | "duplicate" | "storage-unconfigured" | "storage-unsafe" | "write-failed";
      errors?: string[];
    };

/** Stores an image and its row, or refuses without leaving either behind. */
export async function storeFirmware(
  input: unknown,
  admin: { id: string; email: string }
): Promise<StoreResult> {
  const validation = validateFirmwareUpload(input);
  if (!validation.ok) return { ok: false, reason: "invalid", errors: validation.errors };

  const directory = firmwareDirectory();
  if ("problem" in directory) {
    return {
      ok: false,
      reason: directory.problem === "unset" ? "storage-unconfigured" : "storage-unsafe",
    };
  }

  const id = randomUUID();
  const temporaryPath = path.join(directory.path, `${id}.upload`);
  const finalPath = path.join(directory.path, `${id}.bin`);
  const { boardType, version, bytes } = validation;
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  try {
    // Owner-only where the platform carries POSIX modes. An existing directory keeps
    // whatever permissions it was given; this call does not widen or narrow it.
    await mkdir(directory.path, { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, bytes, { mode: 0o600 });
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => {});
    return { ok: false, reason: "write-failed" };
  }

  let created: FirmwareRelease | undefined;
  try {
    const rows = await getDb()
      .insert(firmwareReleases)
      .values({
        id,
        boardType,
        version,
        sizeBytes: bytes.length,
        sha256,
        uploadedBy: admin.id,
      })
      .returning();
    created = rows[0];
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    return { ok: false, reason: isUniqueViolation(error) ? "duplicate" : "write-failed" };
  }

  if (created === undefined) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    return { ok: false, reason: "write-failed" };
  }

  try {
    await rename(temporaryPath, finalPath);
  } catch {
    await getDb().delete(firmwareReleases).where(eq(firmwareReleases.id, id)).catch(() => {});
    await rm(temporaryPath, { force: true }).catch(() => {});
    return { ok: false, reason: "write-failed" };
  }

  recordFirmwareAction(admin.email, "uploaded", boardType, version);
  return { ok: true, release: created };
}

export interface FirmwareListItem extends FirmwareRelease {
  uploaderEmail: string;
}

export async function listFirmware(): Promise<FirmwareListItem[]> {
  const rows = await getDb()
    .select({ release: firmwareReleases, uploaderEmail: users.email })
    .from(firmwareReleases)
    .leftJoin(users, eq(users.id, firmwareReleases.uploadedBy))
    .orderBy(asc(firmwareReleases.boardType), desc(firmwareReleases.uploadedAt));

  return rows.map((row) => ({ ...row.release, uploaderEmail: row.uploaderEmail ?? "" }));
}

/** The one release a board type should run, or nothing. */
export async function targetFor(boardType: string): Promise<FirmwareRelease | undefined> {
  const rows = await getDb()
    .select()
    .from(firmwareReleases)
    .where(and(eq(firmwareReleases.boardType, boardType), eq(firmwareReleases.targeted, true)))
    .limit(1);
  return rows[0];
}

/** Marks one release as its board type's target, replacing whatever held that place. */
export async function markFirmwareTarget(
  id: string,
  forced: boolean,
  adminEmail: string
): Promise<"targeted" | "not-found"> {
  const release = await getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(firmwareReleases)
      .where(eq(firmwareReleases.id, id))
      .limit(1);
    const found = rows[0];
    if (found === undefined) return undefined;

    await tx
      .update(firmwareReleases)
      .set({ targeted: false, forced: false })
      .where(eq(firmwareReleases.boardType, found.boardType));
    await tx
      .update(firmwareReleases)
      .set({ targeted: true, forced })
      .where(eq(firmwareReleases.id, id));
    return found;
  });

  if (release === undefined) return "not-found";
  recordFirmwareAction(
    adminEmail,
    forced ? "targeted (forced)" : "targeted",
    release.boardType,
    release.version
  );
  return "targeted";
}

export async function clearFirmwareTarget(
  id: string,
  adminEmail: string
): Promise<"cleared" | "not-found" | "not-targeted"> {
  const rows = await getDb()
    .select()
    .from(firmwareReleases)
    .where(eq(firmwareReleases.id, id))
    .limit(1);
  const release = rows[0];
  if (release === undefined) return "not-found";
  if (!release.targeted) return "not-targeted";

  await getDb()
    .update(firmwareReleases)
    .set({ targeted: false, forced: false })
    .where(eq(firmwareReleases.id, id));
  recordFirmwareAction(adminEmail, "untargeted", release.boardType, release.version);
  return "cleared";
}

export async function deleteFirmware(
  id: string,
  adminEmail: string
): Promise<"deleted" | "not-found" | "targeted"> {
  const rows = await getDb()
    .select()
    .from(firmwareReleases)
    .where(eq(firmwareReleases.id, id))
    .limit(1);
  const release = rows[0];
  if (release === undefined) return "not-found";
  if (release.targeted) return "targeted";

  await getDb().delete(firmwareReleases).where(eq(firmwareReleases.id, id));
  const directory = firmwareDirectory();
  if ("path" in directory) {
    await rm(path.join(directory.path, `${id}.bin`), { force: true }).catch(() => {});
  }
  recordFirmwareAction(adminEmail, "deleted", release.boardType, release.version);
  return "deleted";
}

export type DownloadLookup =
  | { kind: "found"; path: string; sizeBytes: number }
  | { kind: "not-found" }
  | { kind: "unavailable" };

/**
 * The file behind a release, checked against the size the row promises. A file that
 * is missing, is not a regular file, or is no longer the size recorded is not
 * served: a partial image flashed onto a board is worse than a download that fails,
 * and `lstat` is used so a symbolic link planted at that path is refused rather than
 * followed outside the directory.
 */
export async function releaseForDownload(id: string): Promise<DownloadLookup> {
  const rows = await getDb()
    .select()
    .from(firmwareReleases)
    .where(eq(firmwareReleases.id, id))
    .limit(1);
  const release = rows[0];
  if (release === undefined) return { kind: "not-found" };

  const directory = firmwareDirectory();
  if ("problem" in directory) return { kind: "unavailable" };

  const filePath = path.join(directory.path, `${id}.bin`);
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.size !== release.sizeBytes) return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
  return { kind: "found", path: filePath, sizeBytes: release.sizeBytes };
}

/**
 * The unique constraint on `(board_type, version)`, whichever layer raised it. The
 * driver's error carries `code`; Drizzle may wrap it and keep the original as
 * `cause`, so the check follows one level.
 */
function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 2) return false;
  if ((error as { code?: unknown }).code === "23505") return true;
  return isUniqueViolation((error as { cause?: unknown }).cause, depth + 1);
}
