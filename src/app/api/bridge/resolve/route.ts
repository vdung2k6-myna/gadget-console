import { NextResponse } from "next/server";
import { bridgeAuthorized } from "@/lib/bridge/auth";
import { resolveDevice } from "@/lib/bridge/registry";
import { deviceIdFrom } from "@/lib/http/device-id";
import { tenantForBridgeRequest } from "@/lib/tenancy/bridge";
import { quotaRefusalMessage } from "@/lib/tenancy/quotas";

export async function POST(request: Request) {
  if (!bridgeAuthorized(request)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const deviceId = await deviceIdFrom(request);
  if (deviceId === undefined) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const tenant = await tenantForBridgeRequest(request);
  if (tenant === undefined) {
    return NextResponse.json({ error: "unknown tenant" }, { status: 404 });
  }
  if (tenant.status !== "active") {
    return NextResponse.json({ error: "tenant suspended" }, { status: 423 });
  }

  const resolution = await resolveDevice(deviceId, tenant.id);
  if (resolution.kind === "wrong-tenant") {
    return NextResponse.json({ error: "wrong tenant for this device" }, { status: 403 });
  }
  if (resolution.kind === "quota-exceeded") {
    return NextResponse.json(
      { error: quotaRefusalMessage(resolution.refusal) },
      { status: 403 }
    );
  }
  if (resolution.kind === "rate-limited") {
    return NextResponse.json({ error: "too many claim requests for this device" }, { status: 429 });
  }
  return NextResponse.json(resolution.body);
}
