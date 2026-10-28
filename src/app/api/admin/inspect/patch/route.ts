import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { currentAdmin } from "@/lib/auth/admin";
import { INSPECT_LIMITS, patchAddress, patchImage, patchString } from "@/lib/binary-inspect";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** A filename that can go in a header: the upload's own name, made boring. */
function safeBase(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").replace(/\.bin$/i, "") || "firmware";
}

/**
 * Rewrite one literal inside an uploaded image and hand the result back.
 *
 * Nothing is written: the patched file is the response body, and the headers say what
 * the page must report about it. Turning it into a release is a separate, explicit
 * upload — this route cannot put anything in front of a gadget.
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

  const bytes = Buffer.from(await file.arrayBuffer());
  const mode = String(form.get("mode") ?? "");
  const original = String(form.get("original") ?? "");
  const replace = String(form.get("replace") ?? "");

  // `mode=string` matches a complete C string; `mode=address` matches one complete
  // address wherever it sits, finding the image that owns it; the unmarked path
  // replaces a literal wherever it occurs, for a caller that means exactly that.
  let result: ReturnType<typeof patchImage>;
  if (mode === "address") {
    result = patchAddress(bytes, original, replace);
  } else {
    const offset = Number.parseInt(String(form.get("offset") ?? ""), 10);
    if (!Number.isFinite(offset)) return NextResponse.json({ error: "no-image" }, { status: 400 });
    result =
      mode === "string"
        ? patchString(bytes, offset, original, replace)
        : patchImage(bytes, offset, String(form.get("find") ?? ""), replace);
  }
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });

  return new NextResponse(Buffer.from(result.bytes), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${safeBase(file.name)}-patched.bin"`,
      "x-patch-occurrences": String(result.occurrences),
      "x-patch-sha256": createHash("sha256").update(result.bytes).digest("hex"),
      "x-patch-signed": result.signatureInvalidated ? "1" : "0",
    },
  });
}
