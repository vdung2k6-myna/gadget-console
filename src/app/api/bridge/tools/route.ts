import { NextResponse } from "next/server";
import { bridgeAuthorized } from "@/lib/bridge/auth";
import { recordDeviceTools, validateToolReport } from "@/lib/device-tools";

/**
 * The catalogue a gadget declared this session. The bridge reports it once, after
 * the tool channel has come up; a catalogue over the console's bounds is refused
 * whole so the previous one stands.
 */
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

  const deviceId =
    typeof body === "object" && body !== null ? (body as { deviceId?: unknown }).deviceId : undefined;
  if (typeof deviceId !== "string" || deviceId.trim() === "") {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const validation = validateToolReport(body);
  if (!validation.ok) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  const known = await recordDeviceTools(deviceId, validation.tools);
  return known
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}
