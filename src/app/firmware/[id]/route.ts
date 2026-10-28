import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { releaseForDownload } from "@/lib/firmware";

type Params = { params: Promise<{ id: string }> };

/**
 * The image a gadget downloads when its OTA answer names one.
 *
 * No session: a gadget has none, and cannot hold one. The identifier is a UUID and
 * an image is not a secret, so the URL need not be signed. `Content-Length` is not
 * optional — the firmware refuses a response without one — and the size comes from
 * the release row, checked against the file, so a truncated image is never sent.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const lookup = await releaseForDownload(id);

  if (lookup.kind === "not-found") {
    return new Response("not found\n", { status: 404 });
  }
  if (lookup.kind === "unavailable") {
    return new Response("this release cannot be served\n", { status: 503 });
  }

  const body = Readable.toWeb(createReadStream(lookup.path)) as unknown as ReadableStream;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(lookup.sizeBytes),
      "cache-control": "public, max-age=3600",
    },
  });
}
