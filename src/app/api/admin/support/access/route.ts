import { NextResponse } from "next/server";

import { currentSupport } from "@/lib/auth/admin";
import {
  findSupportDevice,
  openSupportConversation,
} from "@/lib/support-access";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * The explicit support action. It writes the audit row before any conversation
 * text is served; the returned id is the short-lived grant the page checks.
 */
export async function POST(request: Request) {
  const user = await currentSupport();
  if (user === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const deviceId =
    typeof body === "object" && body !== null
      ? (body as { deviceId?: unknown }).deviceId
      : undefined;
  const reason =
    typeof body === "object" && body !== null
      ? (body as { reason?: unknown }).reason
      : undefined;
  if (typeof deviceId !== "string" || deviceId.trim() === "") {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const device = await findSupportDevice(user, deviceId);
  if (device === undefined) return notFound();

  const access = await openSupportConversation(
    user,
    device,
    typeof reason === "string" ? reason : undefined
  );
  if (access === undefined) {
    return NextResponse.json({ error: "the device has no tenant" }, { status: 400 });
  }

  return NextResponse.json(
    { access: { id: access.id, expiresAt: access.expiresAt.toISOString() } },
    { status: 201 }
  );
}
