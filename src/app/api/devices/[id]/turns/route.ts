import { NextResponse } from "next/server";
import { currentUser, notFound, unauthenticated } from "@/lib/auth/guard";
import { ownTurns } from "@/lib/auth/ownership";

type Params = { params: Promise<{ id: string }> };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** An owner reads its own device's turns, most recent first. */
export async function GET(request: Request, { params }: Params) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  const { id } = await params;
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT;

  const rows = await ownTurns(user.id, id, limit);
  return rows === undefined ? notFound() : NextResponse.json({ turns: rows });
}
