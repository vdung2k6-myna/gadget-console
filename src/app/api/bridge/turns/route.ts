import { NextResponse } from "next/server";
import { bridgeAuthorized } from "@/lib/bridge/auth";
import { recordTurn } from "@/lib/bridge/registry";

export async function POST(request: Request) {
  if (!bridgeAuthorized(request)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const result = await recordTurn(body);
  if (!result.ok) {
    return result.reason === "device-not-found"
      ? NextResponse.json({ error: "not found" }, { status: 404 })
      : NextResponse.json({ error: "a turn needs a device, two texts, a language, an engine and both times" }, { status: 400 });
  }

  return NextResponse.json({ id: result.id }, { status: 201 });
}
