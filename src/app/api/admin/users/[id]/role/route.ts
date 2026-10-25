import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth/admin";
import { changeRoleAsAdmin } from "@/lib/users";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * An admin granting or taking away the role. A user reaches this as though it did
 * not exist; the last-admin refusal is a `409` with a code the page turns into
 * words, because the sentence belongs to the interface and not to this route.
 */
export async function PATCH(request: Request, { params }: Params) {
  const admin = await currentAdmin();
  if (admin === undefined) return notFound();

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const role =
    typeof body === "object" && body !== null ? (body as { role?: unknown }).role : undefined;
  if (typeof role !== "string") {
    return NextResponse.json({ error: "role is required" }, { status: 400 });
  }

  const result = await changeRoleAsAdmin(admin.email, id, role);
  if (result.ok) return new NextResponse(null, { status: 204 });

  if (result.reason === "unknown-role") {
    return NextResponse.json({ error: "unknown role" }, { status: 400 });
  }
  if (result.reason === "protected") {
    return NextResponse.json({ error: "protected" }, { status: 409 });
  }
  if (result.reason === "last-admin") {
    return NextResponse.json({ error: "last-admin" }, { status: 409 });
  }
  return notFound();
}
