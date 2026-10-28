import { NextResponse } from "next/server";
import { bridgeAuthorized } from "@/lib/bridge/auth";
import { recordDeviceHardware, validateHardwareReport } from "@/lib/device-hardware";

/**
 * What the gadget's firmware reported about its own board at OTA.
 *
 * The bridge sends this once per connection, after the OTA resolution that
 * created or found the device row, and never waits on the answer — a report is
 * bookkeeping, and a session must not depend on it. A report beyond the console's
 * bounds is refused whole, so the previous one stands.
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

  const record =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const deviceId = record.deviceId;
  if (typeof deviceId !== "string" || deviceId.trim() === "") {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const validation = validateHardwareReport(record.hardware);
  if (!validation.ok) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  const known = await recordDeviceHardware(deviceId, validation.hardware);
  return known
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "not found" }, { status: 404 });
}
