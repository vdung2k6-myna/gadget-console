import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth/admin";
import { INSPECT_LIMITS, findStrings } from "@/lib/binary-inspect";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * The complete strings around what the person typed.
 *
 * A patch that replaces a fragment leaves a NUL in the middle of a value, which ends
 * it early — the failure the page exists to prevent. So the page asks for the whole
 * strings containing a query and edits one of those, and this route answers with the
 * values as a C string reads them. Nothing is written.
 */
export async function POST(request: Request) {
  const admin = await currentAdmin();
  if (admin === undefined) return notFound();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "the body must be form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "a file is required" }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (file.size > INSPECT_LIMITS.maxBytes) {
    return NextResponse.json({ error: "too-large" }, { status: 413 });
  }

  const offset = Number.parseInt(String(form.get("offset") ?? ""), 10);
  if (!Number.isFinite(offset)) return NextResponse.json({ error: "no-image" }, { status: 400 });

  const query = String(form.get("find") ?? "");
  const bytes = Buffer.from(await file.arrayBuffer());
  return NextResponse.json({ strings: findStrings(bytes, offset, query) });
}
