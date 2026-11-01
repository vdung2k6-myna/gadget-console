import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { assertConfigCannotBePackaged, parseOpsConfig, type OpsConfig } from "../scripts/ops/config";
import type { OpsContext } from "../scripts/ops/context";
import { deploy } from "../scripts/ops/deploy";
import { packageService } from "../scripts/ops/package";
import { ssh } from "../scripts/ops/remote";
import {
  guardReasons,
  parseGuard,
  showStatus,
  startSession,
  stopSession,
} from "../scripts/ops/session";
import {
  pruneScript,
  switchToScript,
  verifyDeployment,
} from "../scripts/ops/release";
import { DryRunRunner, ExecRunner, type Command, type CommandResult, type Runner } from "../scripts/ops/runner";
import { SERVICES } from "../scripts/ops/services";
import { probeSpeech } from "../scripts/ops/speech";

/** A runner that answers remote commands from a handler and runs local ones for real. */
class HarnessRunner implements Runner {
  readonly calls: Command[] = [];

  constructor(
    private readonly answer: (command: Command) => CommandResult | undefined,
    private readonly exec = new ExecRunner()
  ) {}

  async run(command: Command): Promise<CommandResult> {
    this.calls.push(command);
    const answered = this.answer(command);
    if (answered !== undefined) return answered;
    if (command.local === true) return this.exec.run(command);
    return { code: 0, stdout: "", stderr: "" };
  }

  commandsMatching(text: string): Command[] {
    return this.calls.filter((command) => command.argv.join(" ").includes(text));
  }
}

const CONFIG: OpsConfig = {
  project: "<project-id>",
  region: "asia-southeast1",
  zone: "asia-southeast1-a",
  instance: "gadget-app",
  databaseInstance: "gadget-db",
  address: "gadget-app-ip",
  deployUser: "<deploy-user>",
  speech: {
    sttUrl: "https://stt.<domain>/health",
    ttsUrl: "https://tts.<domain>/health",
  },
};

const AUDIO = {
  instance: "gadget-audio",
  zone: "asia-southeast1-a",
  healthUrl: "http://10.9.9.9:8082/health",
};

const VALID_SPEECH = {
  sttUrl: "https://stt.example.com/health",
  ttsUrl: "https://tts.example.com/health",
};

function context(runner: Runner, overrides: Partial<OpsContext> = {}): OpsContext {
  return {
    runner,
    config: CONFIG,
    configPath: path.join(os.tmpdir(), "absent-ops-config.json"),
    dryRun: false,
    log: () => {},
    poll: { timeoutMs: 5000, intervalMs: 5 },
    ...overrides,
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ops-repo-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "test"]);
  await writeFile(path.join(dir, "package.json"), '{"name":"fixture"}\n');
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "first"]);
  return dir;
}

function runBash(script: string): void {
  execFileSync("bash", ["-lc", script], { stdio: "pipe" });
}

describe("the operator configuration", () => {
  it("refuses a configuration missing a required key", () => {
    const raw = { ...CONFIG, project: undefined };
    assert.throws(() => parseOpsConfig(raw), /missing project/);
  });

  it("accepts the committed example's placeholders", async () => {
    const example = JSON.parse(await readFile("ops.example.json", "utf8")) as unknown;
    const parsed = parseOpsConfig(example);
    assert.equal(parsed.instance, "gadget-app");
    assert.equal(parsed.speech.sttUrl, "https://stt.example.com/health");
  });

  it("accepts an audio host", () => {
    const parsed = parseOpsConfig({ ...CONFIG, speech: VALID_SPEECH, audio: AUDIO });
    assert.deepEqual(parsed.audio, AUDIO);
  });

  it("refuses an audio host without an instance", () => {
    assert.throws(
      () =>
        parseOpsConfig({
          ...CONFIG,
          speech: VALID_SPEECH,
          audio: { healthUrl: AUDIO.healthUrl },
        }),
      /audio.instance is required/
    );
  });

  it("refuses an audio health address that is not a URL", () => {
    assert.throws(
      () =>
        parseOpsConfig({
          ...CONFIG,
          speech: VALID_SPEECH,
          audio: { ...AUDIO, healthUrl: "10.9.9.9:8082" },
        }),
      /audio.healthUrl must be an http or https URL/
    );
  });

  it("refuses a configuration that the package would carry", async () => {
    const repo = await makeRepo();
    const configPath = path.join(repo, "ops.local.json");
    await writeFile(configPath, "{}\n");
    await assert.rejects(
      assertConfigCannotBePackaged(new ExecRunner(), configPath, repo),
      /inside the repository and not ignored/
    );
    await writeFile(path.join(repo, ".gitignore"), "ops.local.json\n");
    await assertConfigCannotBePackaged(new ExecRunner(), configPath, repo);
  });
});

describe("the services", () => {
  it("names one builder and two build-less services", () => {
    assert.deepEqual(SERVICES.console.build, ["npm", "run", "build"]);
    assert.equal(SERVICES.bridge.build, null);
    assert.equal(SERVICES.runtime.build, null);
    assert.equal(SERVICES.runtime.unit, "gadget-api");
  });
});

describe("packaging", () => {
  it("carries the committed revision and leaves no staging directory", async () => {
    const repo = await makeRepo();
    const expected = git(repo, ["rev-parse", "HEAD"]).trim();
    const packaged = await packageService({
      runner: new ExecRunner(),
      service: "console",
      repoDir: repo,
      now: new Date("2026-11-01T00:00:00.000Z"),
    });
    try {
      assert.equal(packaged.commit, expected);
      assert.equal(packaged.revision.commit, expected);
      assert.ok(existsSync(packaged.tarball));
      const listing = await readdir(path.dirname(packaged.tarball));
      assert.deepEqual(listing.filter((name) => name === "tree"), []);
    } finally {
      await packaged.cleanup();
    }
    assert.equal(existsSync(packaged.tarball), false);
  });

  it("refuses a working tree with uncommitted changes", async () => {
    const repo = await makeRepo();
    await writeFile(path.join(repo, "package.json"), '{"name":"changed"}\n');
    await assert.rejects(
      packageService({ runner: new ExecRunner(), service: "console", repoDir: repo }),
      /uncommitted changes/
    );
  });
});

describe("remote commands", () => {
  it("runs file work as the deployment user, not the SSH login", async () => {
    const runner = new HarnessRunner(() => ({ code: 0, stdout: "", stderr: "" }));
    await ssh(runner, CONFIG, "echo hi", { asUser: CONFIG.deployUser });
    assert.match(
      runner.calls[0].argv.at(-1) ?? "",
      /^--command=sudo -u '<deploy-user>' -H bash -c 'echo hi'$/
    );
  });

  it("runs a restart as the login, which keeps sudo for systemctl", async () => {
    const runner = new HarnessRunner(() => ({ code: 0, stdout: "", stderr: "" }));
    await ssh(runner, CONFIG, "sudo systemctl restart gadget-console");
    assert.equal(runner.calls[0].argv.at(-1), "--command=sudo systemctl restart gadget-console");
  });
});

describe("the dry-run runner", () => {
  it("prints remote commands and only runs local ones", async () => {
    const delegate = new HarnessRunner(() => ({ code: 0, stdout: "", stderr: "" }));
    const lines: string[] = [];
    const dry = new DryRunRunner(delegate, (line) => lines.push(line));
    await dry.run({ argv: ["gcloud", "compute", "instances", "start", "gadget-app"] });
    await dry.run({ argv: ["git", "status", "--porcelain"], local: true });
    assert.equal(delegate.calls.length, 1);
    assert.equal(delegate.calls[0].argv[0], "git");
    assert.match(lines[0], /gcloud compute instances start gadget-app/);
  });
});

describe("the release layout", () => {
  it("switches current through a rename and keeps three releases", async () => {
    const remote = await mkdtemp(path.join(os.tmpdir(), "ops-remote-"));
    const releases = path.join(remote, "releases");
    await mkdir(releases);
    for (const name of ["r1", "r2", "r3", "r4"]) {
      await mkdir(path.join(releases, name));
      const when = new Date(2026, 0, Number(name.slice(1)));
      await utimes(path.join(releases, name), when, when);
    }
    await symlink(path.join(releases, "r4"), path.join(remote, "current"));

    runBash(switchToScript(remote, path.join(releases, "r3")));
    assert.equal(await readlink(path.join(remote, "current")), path.join(releases, "r3"));

    runBash(pruneScript(remote, 3));
    const kept = (await readdir(releases)).sort();
    assert.deepEqual(kept, ["r2", "r3", "r4"]);
  });
});

async function readlink(target: string): Promise<string> {
  return execFileSync("readlink", ["-f", target], { encoding: "utf8" }).trim();
}

describe("verification after a restart", () => {
  const expected = { commit: "abc123", remoteDir: "/srv/gadget-console", switchedAtEpoch: 1000 };
  const good = {
    revision: JSON.stringify({ service: "console", commit: "abc123", packagedAt: "x" }),
    workingDirectory: "/srv/gadget-console/current",
    activeEnterEpoch: 1001,
    health: "200",
  };

  it("accepts a report that matches the package", () => {
    assert.deepEqual(verifyDeployment(good, expected), []);
  });

  it("fails on a different revision", () => {
    const errors = verifyDeployment({ ...good, revision: '{"commit":"old999"}' }, expected);
    assert.match(errors.join("\n"), /reports revision old999, but abc123 was shipped/);
  });

  it("fails on a unit running elsewhere", () => {
    const errors = verifyDeployment({ ...good, workingDirectory: "/srv/gadget-console" }, expected);
    assert.match(errors.join("\n"), /WorkingDirectory is \/srv\/gadget-console, not/);
  });

  it("fails when the unit did not restart", () => {
    const errors = verifyDeployment({ ...good, activeEnterEpoch: 10 }, expected);
    assert.match(errors.join("\n"), /did not restart after the release/);
  });

  it("fails when health is not 200", () => {
    const errors = verifyDeployment({ ...good, health: "500" }, expected);
    assert.match(errors.join("\n"), /health answered 500, not 200/);
  });
});

describe("deploy", () => {
  it("stops before the switch when the build fails", async () => {
    const repo = await makeRepo();
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("npm run build")) return { code: 1, stdout: "", stderr: "bad build" };
      return undefined;
    });
    const ctx = context(runner, {
      config: { ...CONFIG, repositories: { console: repo } },
    });
    await assert.rejects(deploy(ctx, "console"), /building the release failed/);
    assert.equal(runner.commandsMatching("current.next").length, 0);
  });

  it("migrates before the switch, and a failed migration does not switch", async () => {
    const repo = await makeRepo();
    const commit = git(repo, ["rev-parse", "HEAD"]).trim();
    const verified = [
      `revision=${JSON.stringify({ service: "console", commit, packagedAt: "x" })}`,
      "working_directory=/srv/gadget-console/current",
      `active_enter_epoch=${Math.floor(Date.now() / 1000)}`,
      "health=200",
    ].join("\n");
    const ordering = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("drizzle-kit migrate")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("systemctl restart")) return { code: 0, stdout: `${Math.floor(Date.now() / 1000)}\n`, stderr: "" };
      if (text.includes("working_directory=")) return { code: 0, stdout: verified, stderr: "" };
      return undefined;
    });
    await deploy(context(ordering, { config: { ...CONFIG, repositories: { console: repo } } }), "console", {
      migrate: true,
    });
    const migrate = ordering.calls.findIndex((c) => c.argv.join(" ").includes("drizzle-kit migrate"));
    const switchAt = ordering.calls.findIndex((c) => c.argv.join(" ").includes("current.next"));
    assert.ok(migrate >= 0 && switchAt > migrate);

    const failing = new HarnessRunner((command) =>
      command.argv.join(" ").includes("drizzle-kit migrate")
        ? { code: 1, stdout: "", stderr: "migration failed" }
        : undefined
    );
    await assert.rejects(
      deploy(context(failing, { config: { ...CONFIG, repositories: { console: repo } } }), "console", {
        migrate: true,
      }),
      /migrating the database failed/
    );
    assert.equal(failing.commandsMatching("current.next").length, 0);
  });

  it("prints the ship command under dry-run without touching the host", async () => {
    const repo = await makeRepo();
    const lines: string[] = [];
    const base = new HarnessRunner((command) =>
      command.local === true ? undefined : { code: 0, stdout: "", stderr: "" }
    );
    const runner = new DryRunRunner(base, (line) => lines.push(line));
    await deploy(
      context(runner, {
        runner,
        dryRun: true,
        log: (line) => lines.push(line),
        config: { ...CONFIG, repositories: { console: repo } },
      }),
      "console"
    );
    assert.match(lines.join("\n"), /gcloud compute scp .*gadget-app:\/tmp\//);
    assert.equal(base.calls.filter((command) => command.argv[0] === "gcloud").length, 0);
  });

  it("rolls back to the previous release with one restart", async () => {
    const remote = "/srv/gadget-console";
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("readlink -f")) return { code: 0, stdout: `${remote}/releases/b\n`, stderr: "" };
      if (text.includes("ls -1dt")) {
        return { code: 0, stdout: `${remote}/releases/b/\n${remote}/releases/a/\n`, stderr: "" };
      }
      return undefined;
    });
    await deploy(context(runner), "console", { rollback: true });
    assert.equal(runner.commandsMatching("systemctl restart").length, 1);
    assert.equal(runner.commandsMatching("releases/a").length, 1);
  });
});

describe("a session", () => {
  let speech: Server;
  let speechUrl = "";

  before(async () => {
    speech = createServer((_request, response) => {
      response.writeHead(200).end("ok");
    });
    await new Promise<void>((resolve) => speech.listen(0, "127.0.0.1", () => resolve()));
    const address = speech.address();
    if (address === null || typeof address === "string") throw new Error("no server address");
    speechUrl = `http://127.0.0.1:${address.port}/health`;
  });

  after(async () => {
    await new Promise<void>((resolve) => speech.close(() => resolve()));
  });

  it("starts the database before the host and waits for every endpoint", async () => {
    const url = speechUrl;
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("sql instances patch")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("sql instances describe")) return { code: 0, stdout: "RUNNABLE\n", stderr: "" };
      if (text.includes("instances start")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("instances describe")) return { code: 0, stdout: "RUNNING\n", stderr: "" };
      if (text.includes("compute ssh")) return { code: 0, stdout: "ready\n", stderr: "" };
      return undefined;
    });
    await startSession(
      context(runner, { config: { ...CONFIG, speech: { sttUrl: url, ttsUrl: url } } })
    );

    const order = runner.calls.map((command) => command.argv.join(" "));
    const patch = order.findIndex((line) => line.includes("activation-policy=ALWAYS"));
    const start = order.findIndex((line) => line.includes("instances start"));
    const wait = order.findIndex((line) => line.includes("compute ssh"));
    assert.ok(patch >= 0 && start > patch && wait > start);
    assert.ok(runner.calls[patch].argv.includes("--async"));
    assert.ok(runner.calls[start].argv.includes("--async"));
  });

  it("continues when an operation collides but the state is already right", async () => {
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("sql instances patch")) {
        return { code: 1, stdout: "", stderr: "HTTPError 409: another operation was already in progress" };
      }
      if (text.includes("sql instances describe")) return { code: 0, stdout: "RUNNABLE\n", stderr: "" };
      if (text.includes("instances start")) return { code: 1, stdout: "", stderr: "busy" };
      if (text.includes("instances describe")) return { code: 0, stdout: "RUNNING\n", stderr: "" };
      if (text.includes("compute ssh")) return { code: 0, stdout: "ready\n", stderr: "" };
      return undefined;
    });
    await startSession(
      context(runner, { config: { ...CONFIG, speech: { sttUrl: speechUrl, ttsUrl: speechUrl } } })
    );
  });

  it("retries SSH while the host is still booting", async () => {
    let attempts = 0;
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("sql instances patch")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("sql instances describe")) return { code: 0, stdout: "RUNNABLE\n", stderr: "" };
      if (text.includes("instances start")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("instances describe")) return { code: 0, stdout: "RUNNING\n", stderr: "" };
      if (text.includes("compute ssh")) {
        attempts += 1;
        return attempts === 1
          ? { code: 255, stdout: "", stderr: "Connection refused" }
          : { code: 0, stdout: "ready\n", stderr: "" };
      }
      return undefined;
    });
    await startSession(
      context(runner, { config: { ...CONFIG, speech: { sttUrl: speechUrl, ttsUrl: speechUrl } } })
    );
    assert.equal(attempts, 2);
  });

  it("starts the audio host after the app host and waits for its gateway", async () => {
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("sql instances patch")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("sql instances describe")) return { code: 0, stdout: "RUNNABLE\n", stderr: "" };
      if (text.includes("instances start")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("instances describe")) return { code: 0, stdout: "RUNNING\n", stderr: "" };
      if (text.includes("compute ssh")) return { code: 0, stdout: "ready\n", stderr: "" };
      return undefined;
    });
    await startSession(
      context(runner, {
        config: { ...CONFIG, audio: AUDIO, speech: { sttUrl: speechUrl, ttsUrl: speechUrl } },
      })
    );

    const calls = runner.calls.map((command) => command.argv.join(" "));
    const appStart = calls.findIndex(
      (line) => line.includes("instances start") && !line.includes("gadget-audio")
    );
    const audioStart = calls.findIndex(
      (line) => line.includes("instances start") && line.includes("gadget-audio")
    );
    const audioWait = calls.findIndex(
      (line) => line.includes("compute ssh") && line.includes("10.9.9.9")
    );
    assert.ok(appStart >= 0 && audioStart > appStart && audioWait > audioStart);
  });

  it("names the audio host when its gateway never answers", async () => {
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("sql instances patch")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("sql instances describe")) return { code: 0, stdout: "RUNNABLE\n", stderr: "" };
      if (text.includes("instances start")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("instances describe")) return { code: 0, stdout: "RUNNING\n", stderr: "" };
      if (text.includes("compute ssh") && text.includes("10.9.9.9")) {
        return { code: 1, stdout: "timeout:audio gateway answered 000\n", stderr: "" };
      }
      if (text.includes("compute ssh")) return { code: 0, stdout: "ready\n", stderr: "" };
      return undefined;
    });
    await assert.rejects(
      startSession(
        context(runner, {
          config: { ...CONFIG, audio: AUDIO, speech: { sttUrl: speechUrl, ttsUrl: speechUrl } },
        })
      ),
      /did not become healthy: timeout:audio gateway/
    );
  });

  it("stops the audio host between the app host and the database", async () => {
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("compute ssh")) return { code: 0, stdout: "last_turn=0\nsockets=0\n", stderr: "" };
      if (text.includes("instances stop")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("sql instances describe")) return { code: 0, stdout: "STOPPED\n", stderr: "" };
      if (text.includes("instances describe")) return { code: 0, stdout: "TERMINATED\n", stderr: "" };
      if (text.includes("sql instances patch")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("addresses describe")) return { code: 0, stdout: "RESERVED\n", stderr: "" };
      return undefined;
    });
    await stopSession(context(runner, { config: { ...CONFIG, audio: AUDIO } }));

    const calls = runner.calls.map((command) => command.argv.join(" "));
    const appStop = calls.findIndex(
      (line) => line.includes("instances stop") && !line.includes("gadget-audio")
    );
    const audioStop = calls.findIndex(
      (line) => line.includes("instances stop") && line.includes("gadget-audio")
    );
    const database = calls.findIndex((line) => line.includes("activation-policy=NEVER"));
    assert.ok(appStop >= 0 && audioStop > appStop && database > audioStop);
  });

  it("reports the audio host and its gateway", async () => {
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("instances describe") && text.includes("gadget-audio")) {
        return { code: 0, stdout: "STOPPED\n", stderr: "" };
      }
      if (text.includes("instances describe")) return { code: 0, stdout: "RUNNING\n", stderr: "" };
      if (text.includes("sql instances describe")) return { code: 0, stdout: "RUNNABLE\n", stderr: "" };
      if (text.includes("addresses describe")) return { code: 0, stdout: "IN_USE\n", stderr: "" };
      if (text.includes("compute ssh") && text.includes("10.9.9.9")) {
        return { code: 0, stdout: "503", stderr: "" };
      }
      if (text.includes("compute ssh")) return { code: 0, stdout: "", stderr: "" };
      return undefined;
    });
    const lines: string[] = [];
    await showStatus(
      context(runner, {
        config: { ...CONFIG, audio: AUDIO, speech: { sttUrl: speechUrl, ttsUrl: speechUrl } },
        log: (line) => lines.push(line),
      })
    );
    assert.match(lines.join("\n"), /audio\s+STOPPED\s+gateway 503/);
  });

  it("names the dependency that never arrived", async () => {
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("sql instances patch")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("sql instances describe")) return { code: 0, stdout: "PENDING\n", stderr: "" };
      return undefined;
    });
    await assert.rejects(
      startSession(context(runner, { poll: { timeoutMs: 30, intervalMs: 5 } })),
      /waiting for the database to become RUNNABLE/
    );
  });

  it("refuses a stop when a turn is recent or a gadget is connected", async () => {
    const recent = new HarnessRunner((command) =>
      command.argv.join(" ").includes("compute ssh")
        ? { code: 0, stdout: `last_tunnel=ignore\nlast_turn=${Math.floor(Date.now() / 1000)}\nsockets=0\n`, stderr: "" }
        : undefined
    );
    await assert.rejects(stopSession(context(recent)), /refusing to stop: a turn was recorded/);

    const connected = new HarnessRunner((command) =>
      command.argv.join(" ").includes("compute ssh")
        ? { code: 0, stdout: "last_turn=0\nsockets=2\n", stderr: "" }
        : undefined
    );
    await assert.rejects(stopSession(context(connected)), /connected to the bridge \(2 open sockets\)/);
  });

  it("stops the host and then the database when nothing is active", async () => {
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("compute ssh")) return { code: 0, stdout: "last_turn=0\nsockets=0\n", stderr: "" };
      if (text.includes("instances stop")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("sql instances describe")) return { code: 0, stdout: "STOPPED\n", stderr: "" };
      if (text.includes("instances describe")) return { code: 0, stdout: "TERMINATED\n", stderr: "" };
      if (text.includes("sql instances patch")) return { code: 0, stdout: "", stderr: "" };
      if (text.includes("addresses describe")) return { code: 0, stdout: "RESERVED\n", stderr: "" };
      return undefined;
    });
    await stopSession(context(runner));
    const order = runner.calls.map((command) => command.argv.join(" "));
    const stop = order.findIndex((line) => line.includes("instances stop"));
    const database = order.findIndex((line) => line.includes("activation-policy=NEVER"));
    assert.ok(stop >= 0 && database > stop);
    assert.ok(runner.calls[stop].argv.includes("--async"));
    assert.ok(runner.calls[database].argv.includes("--async"));
  });

  it("reports units, revisions and drift without changing anything", async () => {
    const repo = await makeRepo();
    const local = git(repo, ["rev-parse", "HEAD"]).trim();
    const deployed = "abcdef1234567890";
    const statusLines = [
      "unit:console=active",
      "health:console=200",
      `revision:console=${JSON.stringify({ service: "console", commit: deployed, packagedAt: "x" })}`,
      "working:console=/srv/gadget-console/current",
      "unit:bridge=active",
      "health:bridge=200",
      "revision:bridge=none",
      "working:bridge=/srv/gadget-bridge/current",
      "unit:runtime=active",
      "health:runtime=200",
      "revision:runtime=none",
      "working:runtime=/srv/adaptive-interview-api/current",
    ].join("\n");
    const runner = new HarnessRunner((command) => {
      const text = command.argv.join(" ");
      if (text.includes("instances describe")) return { code: 0, stdout: "RUNNING\n", stderr: "" };
      if (text.includes("sql instances describe")) return { code: 0, stdout: "RUNNABLE\n", stderr: "" };
      if (text.includes("addresses describe")) return { code: 0, stdout: "IN_USE\n", stderr: "" };
      if (text.includes("compute ssh")) return { code: 0, stdout: statusLines, stderr: "" };
      return undefined;
    });
    const lines: string[] = [];
    await showStatus(
      context(runner, {
        config: {
          ...CONFIG,
          repositories: { console: repo, bridge: repo, runtime: repo },
          speech: { sttUrl: speechUrl, ttsUrl: speechUrl },
        },
        log: (line) => lines.push(line),
      })
    );
    const output = lines.join("\n");
    assert.match(output, /host\s+RUNNING/);
    assert.match(output, /console\s+active\s+health 200\s+revision abcdef123456/);
    assert.match(output, new RegExp(`drift: local ${local.slice(0, 12)} differs from deployed abcdef123456`));
    assert.equal(runner.commandsMatching("systemctl restart").length, 0);
  });

  it("guards a turn and a socket separately", () => {
    const now = new Date();
    const recent = guardReasons({ lastTurnEpoch: Math.floor(now.getTime() / 1000) - 60, sockets: 0 }, 15, now);
    assert.match(recent.join("; "), /a turn was recorded/);
    const socket = guardReasons({ lastTurnEpoch: null, sockets: 1 }, 15, now);
    assert.match(socket.join("; "), /1 open socket/);
    assert.deepEqual(guardReasons({ lastTurnEpoch: null, sockets: 0 }, 15, now), []);
    assert.equal(parseGuard("last_turn=0\nsockets=3\n").sockets, 3);
  });
});

describe("the speech tier", () => {
  it("probes each endpoint and names the one that fails", async () => {
    const server = createServer((request, response) => {
      response.writeHead(request.url === "/health" ? 200 : 503).end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no server address");
      const base = `http://127.0.0.1:${address.port}`;
      const probes = await probeSpeech(
        { ...CONFIG, speech: { sttUrl: `${base}/health`, ttsUrl: `${base}/tts` } },
        { timeoutMs: 1000 }
      );
      assert.equal(probes[0].ok, true);
      assert.equal(probes[1].ok, false);
      assert.match(probes[1].detail, /503/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
