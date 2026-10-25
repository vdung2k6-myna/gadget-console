import { NextResponse } from "next/server";
import { bridgeAuthorized } from "@/lib/bridge/auth";
import { resolveDevice } from "@/lib/bridge/registry";
import { deviceIdFrom } from "@/lib/http/device-id";

export async function POST(request: Request) {
  if (!bridgeAuthorized(request)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const deviceId = await deviceIdFrom(request);
  if (deviceId === undefined) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const resolution = await resolveDevice(deviceId);
  if (resolution.kind === "rate-limited") {
    return NextResponse.json({ error: "too many claim requests for this device" }, { status: 429 });
  }
  return NextResponse.json(resolution.body);
}
