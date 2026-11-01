import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Runner } from "./runner";

/**
 * A deploy package exists only for the length of one deploy: it is built from
 * a committed revision into a temporary directory, shipped, and removed. There
 * is no tarball left behind for a later release to pick up by mistake.
 */
export interface Revision {
  service: string;
  commit: string;
  packagedAt: string;
}

export interface Packaged {
  service: string;
  commit: string;
  tarball: string;
  revision: Revision;
  /** Removes the tarball and everything packaging created. */
  cleanup: () => Promise<void>;
}

export async function packageService(options: {
  runner: Runner;
  service: string;
  repoDir: string;
  now?: Date;
}): Promise<Packaged> {
  const { runner, service, repoDir } = options;
  const now = options.now ?? new Date();

  const head = await run(
    runner,
    ["git", "-C", repoDir, "rev-parse", "HEAD"],
    "reading the committed revision",
    true
  );
  const commit = head.stdout.trim();
  if (commit === "") throw new Error(`${repoDir} has no committed revision to package`);

  const status = await run(
    runner,
    ["git", "-C", repoDir, "status", "--porcelain"],
    "checking the working tree",
    true
  );
  if (status.stdout.trim() !== "") {
    throw new Error(
      `refusing to deploy ${service}: the working tree has uncommitted changes, and a package holds only a committed revision:\n${status.stdout.trim()}`
    );
  }

  const root = await mkdtemp(path.join(os.tmpdir(), `gadget-deploy-${service}-`));
  const staging = path.join(root, "tree");
  const tarball = path.join(root, `${service}-${commit.slice(0, 12)}.tar.gz`);
  try {
    await mkdir(staging);
    const archive = path.join(root, "tree.tar");
    await run(
      runner,
      ["git", "-C", repoDir, "archive", "--format=tar", `--output=${archive}`, "HEAD"],
      "packaging the committed revision",
      true
    );
    await run(runner, ["tar", "-xf", archive, "-C", staging], "unpacking the package", true);

    const revision: Revision = { service, commit, packagedAt: now.toISOString() };
    await writeFile(path.join(staging, "REVISION"), `${JSON.stringify(revision)}\n`);
    await run(runner, ["tar", "-czf", tarball, "-C", staging, "."], "building the package", true);

    return {
      service,
      commit,
      tarball,
      revision,
      cleanup: async () => {
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function run(
  runner: Runner,
  argv: string[],
  doing: string,
  local = false
): Promise<{ stdout: string; stderr: string }> {
  const result = await runner.run({ argv, local });
  if (result.code !== 0) {
    throw new Error(
      `${doing} failed (${argv[0]} exited ${result.code})${result.stderr.trim() === "" ? "" : `:\n${result.stderr.trim()}`}`
    );
  }
  return { stdout: result.stdout, stderr: result.stderr };
}
