import { NextResponse } from "next/server";
import { deleteAgent, updateAgent, validateAgentDraft } from "@/lib/agents";
import { currentUser, notFound, unauthenticated } from "@/lib/auth/guard";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ["the body must be JSON"] }, { status: 400 });
  }

  const validation = await validateAgentDraft(body, user.id);
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const agent = await updateAgent(user.id, id, validation.draft);
  return agent === undefined ? notFound() : NextResponse.json({ agent });
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  const { id } = await params;
  return (await deleteAgent(user.id, id)) ? new NextResponse(null, { status: 204 }) : notFound();
}
