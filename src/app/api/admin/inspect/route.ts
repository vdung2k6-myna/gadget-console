import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth/admin";
import { INSPECT_LIMITS, inspectBinary } from "@/lib/binary-inspect";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * Reading an uploaded file, and nothing else.
 *
 * The bytes are parsed in this request and dropped with it: no directory, no row,
 * no cache. A file someone is only looking at must not become something a gadget
 * can be pointed at, so this route has no way to write.
 *
 * The size is checked from the file's own metadata before the body is read, so an
 * oversized upload is refused rather than buffered.
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
  if (file.size === 0) {
    return NextResponse.json({ error: "empty" }, { status: 400 });
  }
  if (file.size > INSPECT_LIMITS.maxBytes) {
    return NextResponse.json(
      { error: "too-large", maxBytes: INSPECT_LIMITS.maxBytes },
      { status: 413 }
    );
  }

  return NextResponse.json(inspectBinary(Buffer.from(await file.arrayBuffer())));
}
