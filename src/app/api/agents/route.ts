import { NextResponse } from "next/server";
import { createAgent, listAgents, validateAgentDraft } from "@/lib/agents";
import { currentUser, unauthenticated } from "@/lib/auth/guard";

export async function GET() {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();
  return NextResponse.json({ agents: await listAgents(user.id) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ["the body must be JSON"] }, { status: 400 });
  }

  const validation = await validateAgentDraft(body, user.id);
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  return NextResponse.json({ agent: await createAgent(user.id, validation.draft) }, { status: 201 });
}
