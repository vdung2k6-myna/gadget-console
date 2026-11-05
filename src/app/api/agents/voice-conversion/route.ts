import { NextResponse } from "next/server";

import { currentUser, unauthenticated } from "@/lib/auth/guard";
import { findRuntime } from "@/lib/runtimes";

/**
 * The deployment's voice-conversion settings, read from the runtime an agent
 * uses.
 *
 * The console does not know the runtime's environment, so it asks the runtime's
 * own endpoint with the runtime's token — server to server. The token never
 * reaches the browser; the browser only reads this answer.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  const runtimeId = new URL(request.url).searchParams.get("runtimeId") ?? "";
  if (runtimeId === "") {
    return NextResponse.json({ ok: false, error: "runtimeId is required" }, { status: 400 });
  }

  const runtime = await findRuntime(runtimeId);
  if (runtime === undefined) {
    return NextResponse.json({ ok: false, error: "runtime not found" }, { status: 404 });
  }

  try {
    const response = await fetch(new URL("/api/voice-conversion", runtime.baseUrl), {
      headers: { Authorization: `Bearer ${runtime.token}` },
      signal: AbortSignal.timeout(3500),
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: `runtime answered ${response.status}` },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, config: await response.json() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "runtime unreachable" },
      { status: 502 }
    );
  }
}
