import { NextResponse } from "next/server";
import { bridgeAuthorized } from "@/lib/bridge/auth";
import { activationState } from "@/lib/bridge/registry";
import { deviceIdFrom } from "@/lib/http/device-id";

/**
 * The answer the firmware reads off `POST /activate`: `202` while the claim is
 * pending, `200` once it is complete. Anything else makes the gadget report a
 * failed activation, so "unknown" is a 404 and never a 202.
 */
export async function POST(request: Request) {
  if (!bridgeAuthorized(request)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const deviceId = await deviceIdFrom(request);
  if (deviceId === undefined) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const state = await activationState(deviceId);
  if (state === "owned") return NextResponse.json({ activated: true });
  if (state === "pending") return NextResponse.json({ activated: false }, { status: 202 });
  return NextResponse.json({ activated: false, error: "no claim for this device" }, { status: 404 });
}
