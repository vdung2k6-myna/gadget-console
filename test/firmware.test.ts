import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, getDb, requireTestDatabase, resetDb } from "./helpers/db";
import { registerAccount } from "../src/lib/auth/accounts";
import { users } from "../src/lib/db/schema";
import {
  clearFirmwareTarget,
  deleteFirmware,
  firmwareDirectory,
  listFirmware,
  markFirmwareTarget,
  releaseForDownload,
  storeFirmware,
  targetFor,
  validateFirmwareUpload,
} from "../src/lib/firmware";
import { firmwareReleases } from "../src/lib/db/schema";

let directory = "";

before(async () => {
  requireTestDatabase();
  directory = await mkdtemp(path.join(tmpdir(), "gc-firmware-"));
  process.env.FIRMWARE_DIR = directory;
});

beforeEach(resetDb);

after(async () => {
  await closeDb();
  await rm(directory, { recursive: true, force: true });
});

/** An ESP application image starts with 0xE9; the rest of this fixture is not a real build. */
function image(size = 8): Buffer {
  const bytes = Buffer.alloc(size, 0x11);
  bytes[0] = 0xe9;
  return bytes;
}

async function admin() {
  const result = await registerAccount("root@example.com", "a good password");
  if (result.ok) return result.user;
  const rows = await getDb()
    .select()
    .from(users)
    .where(eq(users.email, "root@example.com"))
    .limit(1);
  if (rows[0] === undefined) throw new Error("could not register");
  return rows[0];
}

async function stored(boardType = "esp-box-3", version = "1.2.4", bytes = image()) {
  const account = await admin();
  const result = await storeFirmware({ boardType, version, bytes }, account);
  if (!result.ok) throw new Error(`could not store: ${result.reason}`);
  return result.release;
}

describe("validating an upload", () => {
  it("accepts an ESP image for a board type and version", () => {
    const result = validateFirmwareUpload({
      boardType: " esp-box-3 ",
      version: " 1.2.4 ",
      bytes: image(),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.boardType, "esp-box-3");
    assert.equal(result.version, "1.2.4");
  });

  it("refuses an empty image, a file that is not one, and a bad name", () => {
    assert.equal(validateFirmwareUpload({ boardType: "esp-box-3", version: "1", bytes: Buffer.alloc(0) }).ok, false);
    assert.equal(
      validateFirmwareUpload({ boardType: "esp-box-3", version: "1", bytes: Buffer.from("hello") }).ok,
      false
    );
    assert.equal(validateFirmwareUpload({ boardType: "not a board", version: "1", bytes: image() }).ok, false);
    assert.equal(validateFirmwareUpload({ boardType: "esp-box-3", version: "1 2", bytes: image() }).ok, false);
    assert.equal(validateFirmwareUpload(null).ok, false);
  });

  it("refuses an image past the deployment's size bound", () => {
    const previous = process.env.FIRMWARE_MAX_BYTES;
    process.env.FIRMWARE_MAX_BYTES = "16";
    try {
      assert.equal(
        validateFirmwareUpload({ boardType: "esp-box-3", version: "1", bytes: image(17) }).ok,
        false
      );
    } finally {
      if (previous === undefined) delete process.env.FIRMWARE_MAX_BYTES;
      else process.env.FIRMWARE_MAX_BYTES = previous;
    }
  });
});

describe("storing a release", () => {
  it("keeps the image, its row, its hash, and records the upload", async (t) => {
    const logged = t.mock.method(console, "log");
    const account = await admin();
    const bytes = image(32);

    const result = await storeFirmware(
      { boardType: "esp-box-3", version: "1.2.4", bytes },
      account
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.release.sizeBytes, 32);
    assert.equal(result.release.boardType, "esp-box-3");
    assert.equal(result.release.uploadedBy, account.id);

    const file = await readFile(path.join(directory, `${result.release.id}.bin`));
    assert.deepEqual(file, bytes);

    const listed = await listFirmware();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.uploaderEmail, "root@example.com");

    const line = String(logged.mock.calls[0]?.arguments[0] ?? "");
    assert.match(line, /^\[admin\] root@example\.com uploaded firmware esp-box-3 1\.2\.4$/);
  });

  it("refuses a second image for the same board type and version, and leaves one row", async () => {
    await stored("esp-box-3", "1.2.4");
    const account = await admin();
    const again = await storeFirmware(
      { boardType: "esp-box-3", version: "1.2.4", bytes: image() },
      account
    );
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.equal(again.reason, "duplicate");

    const rows = await getDb().select().from(firmwareReleases);
    assert.equal(rows.length, 1);
  });

  it("refuses to store when the deployment named no directory", async () => {
    const previous = process.env.FIRMWARE_DIR;
    delete process.env.FIRMWARE_DIR;
    try {
      const result = await storeFirmware(
        { boardType: "esp-box-3", version: "1.2.4", bytes: image() },
        await admin()
      );
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.reason, "storage-unconfigured");
    } finally {
      if (previous !== undefined) process.env.FIRMWARE_DIR = previous;
    }
  });
});

describe("choosing the target", () => {
  it("moves the target to one release per board type", async () => {
    const first = await stored("esp-box-3", "1.2.3");
    const second = await stored("esp-box-3", "1.2.4");
    await stored("bread-compact-wifi-lcd", "2.0.0");

    assert.equal(await markFirmwareTarget(first.id, false, "root@example.com"), "targeted");
    assert.equal((await targetFor("esp-box-3"))?.id, first.id);

    assert.equal(await markFirmwareTarget(second.id, true, "root@example.com"), "targeted");
    const target = await targetFor("esp-box-3");
    assert.equal(target?.id, second.id);
    assert.equal(target?.forced, true);

    const others = (await listFirmware()).filter(
      (release) => release.boardType === "esp-box-3" && release.id !== second.id
    );
    assert.equal(others[0]?.targeted, false);
    assert.equal(others[0]?.forced, false);

    assert.equal((await targetFor("bread-compact-wifi-lcd")), undefined);
  });

  it("clears a target and records it", async (t) => {
    const logged = t.mock.method(console, "log");
    const release = await stored();
    await markFirmwareTarget(release.id, false, "root@example.com");

    assert.equal(await clearFirmwareTarget(release.id, "root@example.com"), "cleared");
    assert.equal(await targetFor("esp-box-3"), undefined);
    assert.equal(await clearFirmwareTarget(release.id, "root@example.com"), "not-targeted");
    assert.ok(
      logged.mock.calls.some((call) =>
        /untargeted firmware esp-box-3 1\.2\.4/.test(String(call.arguments[0]))
      )
    );
  });
});

describe("deleting a release", () => {
  it("refuses while it is the target, then removes the row and the file", async () => {
    const release = await stored();
    await markFirmwareTarget(release.id, false, "root@example.com");
    const file = path.join(directory, `${release.id}.bin`);

    assert.equal(await deleteFirmware(release.id, "root@example.com"), "targeted");
    assert.equal((await getDb().select().from(firmwareReleases)).length, 1);
    assert.ok(await stat(file));

    assert.equal(await clearFirmwareTarget(release.id, "root@example.com"), "cleared");
    assert.equal(await deleteFirmware(release.id, "root@example.com"), "deleted");
    assert.equal((await getDb().select().from(firmwareReleases)).length, 0);
    await assert.rejects(() => stat(file));
  });

  it("answers not found for an identifier that names nothing", async () => {
    assert.equal(
      await deleteFirmware("00000000-0000-4000-8000-000000000000", "root@example.com"),
      "not-found"
    );
  });
});

describe("protecting the storage directory", () => {
  it("refuses the web server's public directory and anything under it", async () => {
    const original = process.env.FIRMWARE_DIR;
    const inside = path.join(process.cwd(), "public", "firmware-test");
    assert.deepEqual(firmwareDirectory(), { path: path.resolve(directory) });

    try {
      for (const configured of [path.join(process.cwd(), "public"), inside]) {
        process.env.FIRMWARE_DIR = configured;
        assert.deepEqual(firmwareDirectory(), { problem: "inside-public" });
        const result = await storeFirmware(
          { boardType: "esp-box-3", version: "9.9.9", bytes: image() },
          await admin()
        );
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.reason, "storage-unsafe");
        assert.equal((await getDb().select().from(firmwareReleases)).length, 0);
      }
    } finally {
      if (original === undefined) delete process.env.FIRMWARE_DIR;
      else process.env.FIRMWARE_DIR = original;
    }
  });

  it("refuses to serve when the configured directory is unsafe", async () => {
    const release = await stored();
    process.env.FIRMWARE_DIR = path.join(process.cwd(), "public");
    try {
      assert.equal((await releaseForDownload(release.id)).kind, "unavailable");
    } finally {
      process.env.FIRMWARE_DIR = directory;
    }
  });

  it("creates the directory and image owner-only where the platform carries modes", async (t) => {
    if (process.platform === "win32") {
      t.skip("Windows does not carry POSIX creation modes");
      return;
    }
    const fresh = path.join(directory, "fresh");
    process.env.FIRMWARE_DIR = fresh;
    try {
      const result = await storeFirmware(
        { boardType: "esp-box-3", version: "2.0.0", bytes: image() },
        await admin()
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal((await stat(fresh)).mode & 0o777, 0o700);
      assert.equal((await stat(path.join(fresh, `${result.release.id}.bin`))).mode & 0o777, 0o600);
    } finally {
      process.env.FIRMWARE_DIR = directory;
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it("refuses a directory or a symbolic link at the release's path", async () => {
    const release = await stored();
    const file = path.join(directory, `${release.id}.bin`);

    // A directory in the image's place.
    await rm(file);
    await mkdir(file);
    assert.equal((await releaseForDownload(release.id)).kind, "unavailable");
    await rm(file, { recursive: true, force: true });

    // A symbolic link, where the platform lets the test make one.
    const target = path.join(directory, "outside.bin");
    await writeFile(target, image());
    try {
      await symlink(target, file, "file");
    } catch {
      return; // No symlink privilege on this platform: the directory case already pins the rule.
    }
    assert.equal((await releaseForDownload(release.id)).kind, "unavailable");
  });
});

describe("serving a release", () => {
  it("finds the file and reports its recorded size", async () => {
    const release = await stored(undefined, undefined, image(64));
    const found = await releaseForDownload(release.id);
    assert.equal(found.kind, "found");
    if (found.kind !== "found") return;
    assert.equal(found.sizeBytes, 64);
    assert.deepEqual(await readFile(found.path), image(64));
  });

  it("answers not found for an unknown id, and refuses a file that changed size", async () => {
    assert.equal(
      (await releaseForDownload("00000000-0000-4000-8000-000000000000")).kind,
      "not-found"
    );

    const release = await stored();
    const file = path.join(directory, `${release.id}.bin`);
    await writeFile(file, image(4));
    assert.equal((await releaseForDownload(release.id)).kind, "unavailable");
  });
});
