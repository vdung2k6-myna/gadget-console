import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth/admin";
import { loadConfig } from "@/lib/config";
import { listFirmware, storeFirmware } from "@/lib/firmware";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** Every release, for the admin page. */
export async function GET() {
  const admin = await currentAdmin();
  if (admin === undefined) return notFound();
  return NextResponse.json({ releases: await listFirmware() });
}

/**
 * An upload. The binary travels as form data beside its board type and version; the
 * size is checked before the body is read, so an oversized file is refused rather
 * than buffered.
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

  const boardType = form.get("boardType");
  const version = form.get("version");
  const file = form.get("file");
  if (typeof boardType !== "string" || typeof version !== "string" || !(file instanceof File)) {
    return NextResponse.json(
      { error: "boardType, version and file are required" },
      { status: 400 }
    );
  }

  const max = loadConfig().firmwareMaxBytes;
  if (file.size > max) {
    return NextResponse.json({ errors: [`the image is larger than ${max} bytes`] }, { status: 400 });
  }

  const result = await storeFirmware(
    { boardType, version, bytes: Buffer.from(await file.arrayBuffer()) },
    admin
  );

  if (result.ok) return NextResponse.json({ release: result.release }, { status: 201 });
  if (result.reason === "invalid") {
    return NextResponse.json({ errors: result.errors }, { status: 400 });
  }
  if (result.reason === "duplicate") {
    return NextResponse.json({ error: "duplicate" }, { status: 409 });
  }
  if (result.reason === "storage-unconfigured") {
    return NextResponse.json({ error: "storage-unconfigured" }, { status: 503 });
  }
  if (result.reason === "storage-unsafe") {
    return NextResponse.json({ error: "storage-unsafe" }, { status: 503 });
  }
  return NextResponse.json({ error: "write-failed" }, { status: 500 });
}
