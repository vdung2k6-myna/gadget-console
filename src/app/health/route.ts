import { NextResponse } from "next/server";
import { pingDatabase } from "@/lib/db/client";

/**
 * Readiness, not liveness: it answers 200 only when the database this console
 * owns can be reached, because a console that cannot reach it can serve nothing
 * and admitting the difference late is what the bridge's fail-closed rule costs.
 */
export async function GET() {
  try {
    await pingDatabase();
    return NextResponse.json({ ok: true, database: "reachable" });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        database: "unreachable",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503 }
    );
  }
}
