import { NextResponse } from "next/server";
import { currentUser, unauthenticated } from "@/lib/auth/guard";
import { claimDevice, pendingRequestsFor } from "@/lib/claims";
import { publicDevice } from "@/lib/devices";

/**
 * Entering the code the gadget shows. Three refusals are distinguished because
 * each tells the person something different to do: an unknown or used code, an
 * expired one, and one already claimed by somebody else.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }
  const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : undefined;
  if (typeof code !== "string" || code.trim() === "") {
    return NextResponse.json({ error: "a code is required" }, { status: 400 });
  }

  const result = await claimDevice(user.id, code);
  if (!result.ok) {
    const [status, error] =
      result.reason === "expired"
        ? [410, "that code has expired; the gadget will show a new one"]
        : result.reason === "taken"
          ? [409, "that gadget already has an owner"]
          : [404, "that code is not one waiting to be entered"];
    return NextResponse.json({ error }, { status });
  }

  // The code is used and the request is waiting for an admin; the gadget keeps
  // polling /activate, and connects only once the request is approved.
  return NextResponse.json(
    { status: "awaiting-approval", device: publicDevice(result.device) },
    { status: 202 }
  );
}

/** The requests this account has made that are still waiting. */
export async function GET() {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();
  return NextResponse.json({ requests: await pendingRequestsFor(user.id) });
}
