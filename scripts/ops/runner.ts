import { spawn } from "node:child_process";

/**
 * Every command the operator tool runs goes through a Runner, so a test can
 * substitute one, and `--dry-run` can print instead of performing.
 *
 * `local` marks a command that only touches the operator's machine (git, tar).
 * A dry run still executes those, because planning a deploy needs the commit
 * and the package; every remote or mutating command is printed and skipped.
 */
export interface Command {
  argv: string[];
  local?: boolean;
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Runner {
  run(command: Command): Promise<CommandResult>;
}

export class ExecRunner implements Runner {
  async run({ argv }: Command): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  }
}

export class DryRunRunner implements Runner {
  constructor(
    private readonly delegate: Runner,
    private readonly out: (line: string) => void
  ) {}

  async run(command: Command): Promise<CommandResult> {
    this.out(`$ ${command.argv.map(shellQuote).join(" ")}`);
    if (command.local === true) return this.delegate.run(command);
    return { code: 0, stdout: "", stderr: "" };
  }
}

/** A display form of one argument; not a shell parser. */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** An argument for the remote shell snippets: bare when safe, single-quoted otherwise. */
export function sh(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
