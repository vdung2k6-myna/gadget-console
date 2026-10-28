import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth/admin";
import { INSPECT_LIMITS, extractImage } from "@/lib/binary-inspect";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

function safeBase(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").replace(/\.bin$/i, "") || "firmware";
}

/**
 * One image out of an uploaded file, on its own.
 *
 * A full dump is not what OTA installs; the application image inside it is. This is
 * the same bytes the inspector found, cut at the image's own boundary — no parse is
 * trusted beyond what the header and segment table say.
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

  const image = extractImage(Buffer.from(await file.arrayBuffer()), offset);
  if (image === null) return NextResponse.json({ error: "no-image" }, { status: 400 });

  return new NextResponse(Buffer.from(image), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${safeBase(file.name)}-0x${offset.toString(16)}.bin"`,
    },
  });
}
