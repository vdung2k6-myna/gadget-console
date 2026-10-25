import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A page that reads the clock by itself cannot be built: Next renders it ahead
 * of time, finds a value that would differ on every render, and fails the
 * build. The fix is one clock per request, from `requestNow()`, which marks the
 * render as request-time before reading. This test keeps the next page from
 * reaching for `new Date()` directly.
 */
const ROOTS = ["src/app", "src/components"];

function components(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...components(path));
    else if (entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

describe("the clock a component renders against", () => {
  it("is read once per request, never inside a component", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of components(root)) {
        const source = readFileSync(file, "utf8");
        if (/\bnew Date\(\s*\)|\bDate\.now\(\)/.test(source)) offenders.push(file);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "these components read the clock themselves; take it from requestNow() instead",
    );
  });

  it("is declared request-time by the session gate the layout calls", () => {
    // The session row is matched with an expiry comparison against now, and the
    // root layout asks for the session on every route. Without `connection()`
    // here, Next prerenders the shell, meets that clock read, and fails every
    // page — with the page's own requestNow() coming too late to help.
    const source = readFileSync("src/lib/auth/require-user.ts", "utf8");
    const gate = source.slice(source.indexOf("export async function optionalUser"));
    assert.match(gate, /await connection\(\)/, "optionalUser() must await connection() first");
  });
});
