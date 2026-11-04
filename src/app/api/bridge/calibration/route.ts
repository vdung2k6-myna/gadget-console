import { NextResponse } from "next/server";

import { bridgeAuthorized } from "@/lib/bridge/auth";
import { setDeviceCalibration, validatePair } from "@/lib/device-calibration";

/**
 * A device's own calibration session writes its measured pair here.
 *
 * Bridge-authenticated rather than administrator: the session runs at the gadget, on the bridge's
 * credential, and its actor is recorded as the session so the audit says where the value came
 * from. Every other write goes through the administrator routes.
 */
export async function PUT(request: Request) {
  if (!bridgeAuthorized(request)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ["the body must be JSON"] }, { status: 400 });
  }
  if (body === null || typeof body !== "object" || typeof (body as { deviceId?: unknown }).deviceId !== "string") {
    return NextResponse.json({ errors: ["deviceId is required"] }, { status: 400 });
  }
  const deviceId = (body as { deviceId: string }).deviceId;
  const validation = validatePair(body);
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const view = await setDeviceCalibration({ deviceId }, validation.pair, "session");
  if (view === null) return NextResponse.json({ error: "unknown device" }, { status: 404 });
  return NextResponse.json(view);
}
