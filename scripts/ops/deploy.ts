import path from "node:path";

import { assertConfigCannotBePackaged, DEFAULT_KEEP_RELEASES } from "./config";
import type { OpsContext } from "./context";
import { packageService } from "./package";
import { scp, ssh } from "./remote";
import {
  buildScript,
  installScript,
  linkScript,
  migrateScript,
  parseReport,
  prepareScript,
  pruneScript,
  restartScript,
  switchToScript,
  verifyDeployment,
  verifyScript,
} from "./release";
import { sh } from "./runner";
import { resolveRepository, SERVICES, type ServiceName } from "./services";

/**
 * A deploy either leaves the shipped revision serving and verified, or leaves
 * the previous release serving and exits non-zero. There is no third outcome.
 */
export interface DeployOptions {
  migrate?: boolean;
  rollback?: boolean;
}

export async function deploy(
  ctx: OpsContext,
  service: ServiceName,
  options: DeployOptions = {}
): Promise<void> {
  const definition = SERVICES[service];

  if (options.rollback === true) {
    await rollback(ctx, service);
    return;
  }

  if (options.migrate === true && service !== "console") {
    throw new Error("--migrate applies only to the console: it is the only service with a schema");
  }

  const repoDir = resolveRepository(ctx.config, service);
  await assertConfigCannotBePackaged(ctx.runner, ctx.configPath, repoDir);

  const packaged = await packageService({
    runner: ctx.runner,
    service,
    repoDir,
  });

  try {
    const remoteTarball = `/tmp/${path.basename(packaged.tarball)}`;
    const short = packaged.commit.slice(0, 12);
    const asUser = { asUser: ctx.config.deployUser };
    ctx.log(`shipping ${service} ${short} to ${definition.remoteDir}`);

    expect(
      await scp(ctx.runner, ctx.config, packaged.tarball, remoteTarball),
      "shipping the package"
    );
    expect(
      await ssh(
        ctx.runner,
        ctx.config,
        prepareScript(definition.remoteDir, packaged.commit, remoteTarball),
        asUser
      ),
      "unpacking the package"
    );
    expect(
      await ssh(ctx.runner, ctx.config, `rm -f ${sh(remoteTarball)}`),
      "removing the package from the host"
    );
    expect(
      await ssh(
        ctx.runner,
        ctx.config,
        installScript(definition.remoteDir, packaged.commit),
        asUser
      ),
      "installing dependencies"
    );
    if (definition.build !== null) {
      expect(
        await ssh(
          ctx.runner,
          ctx.config,
          buildScript(definition.remoteDir, packaged.commit, definition.build),
          asUser
        ),
        "building the release"
      );
    }
    if (options.migrate === true) {
      expect(
        await ssh(
          ctx.runner,
          ctx.config,
          migrateScript(definition.remoteDir, packaged.commit),
          asUser
        ),
        "migrating the database"
      );
    }

    expect(
      await ssh(
        ctx.runner,
        ctx.config,
        linkScript(definition.remoteDir, packaged.commit),
        asUser
      ),
      "switching the release"
    );
    const restarted = expect(
      await ssh(ctx.runner, ctx.config, restartScript(definition.unit)),
      "restarting the unit"
    );

    if (ctx.dryRun) {
      ctx.log("dry run: verification and pruning are not performed");
      return;
    }

    const switchedAtEpoch = Number(restarted.stdout.trim().split("\n").at(-1) ?? "");
    const verified = expect(
      await ssh(
        ctx.runner,
        ctx.config,
        verifyScript(definition.remoteDir, definition.unit, definition.healthUrl)
      ),
      "reading the deployment back"
    );
    const errors = verifyDeployment(parseReport(verified.stdout), {
      commit: packaged.commit,
      remoteDir: definition.remoteDir,
      switchedAtEpoch,
    });
    if (errors.length > 0) {
      throw new Error(`the deploy did not verify:\n- ${errors.join("\n- ")}`);
    }

    expect(
      await ssh(
        ctx.runner,
        ctx.config,
        pruneScript(definition.remoteDir, DEFAULT_KEEP_RELEASES),
        asUser
      ),
      "pruning old releases"
    );
    ctx.log(`deployed and verified ${service} ${short}`);
  } finally {
    await packaged.cleanup();
  }
}

async function rollback(ctx: OpsContext, service: ServiceName): Promise<void> {
  const definition = SERVICES[service];
  const remoteDir = definition.remoteDir;

  if (ctx.dryRun) {
    await ssh(ctx.runner, ctx.config, `readlink -f ${sh(`${remoteDir}/current`)}`);
    await ssh(ctx.runner, ctx.config, `ls -1dt ${sh(`${remoteDir}/releases`)}/*/`);
    ctx.log(`dry run: would switch ${service} back to the previous release and restart ${definition.unit}`);
    return;
  }

  const current = expect(
    await ssh(ctx.runner, ctx.config, `readlink -f ${sh(`${remoteDir}/current`)}`),
    "reading the current release"
  );
  const listing = expect(
    await ssh(ctx.runner, ctx.config, `ls -1dt ${sh(`${remoteDir}/releases`)}/*/`),
    "listing releases"
  );
  const currentPath = current.stdout.trim();
  const previous = listing.stdout
    .split("\n")
    .map((line) => line.trim().replace(/\/$/, ""))
    .filter((line) => line !== "" && line !== currentPath)[0];

  if (previous === undefined) {
    throw new Error(`there is no previous release for ${service} to return to`);
  }

  expect(
    await ssh(ctx.runner, ctx.config, switchToScript(remoteDir, previous), {
      asUser: ctx.config.deployUser,
    }),
    "switching the release"
  );
  expect(
    await ssh(ctx.runner, ctx.config, restartScript(definition.unit)),
    "restarting the unit"
  );
  ctx.log(`rolled ${definition.unit} back to ${previous}; migrations are not reversed`);
}

function expect(
  result: { code: number; stdout: string; stderr: string },
  doing: string
): { code: number; stdout: string; stderr: string } {
  if (result.code !== 0) {
    throw new Error(
      `${doing} failed (exit ${result.code})${result.stderr.trim() === "" ? "" : `:\n${result.stderr.trim()}`}`
    );
  }
  return result;
}
