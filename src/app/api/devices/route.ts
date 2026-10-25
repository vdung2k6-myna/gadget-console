import { NextResponse } from "next/server";
import { currentUser, unauthenticated } from "@/lib/auth/guard";
import { listOwnedDevices } from "@/lib/devices";

export async function GET() {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();
  return NextResponse.json({ devices: await listOwnedDevices(user.id) });
}
