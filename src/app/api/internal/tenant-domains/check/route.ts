import { NextResponse } from "next/server";

import { canIssueCertificate } from "@/lib/tenancy/domains";
import { normalizeHost } from "@/lib/tenancy/request";

/**
 * The authority Caddy's `on_demand_tls` asks before requesting a certificate.
 *
 * It is reachable only over loopback: Caddy runs on the same host and calls
 * `http://127.0.0.1:3001/...`, while a request that came through Caddy carries
 * `x-forwarded-for`. A missing or unregistered host answers 404, which Caddy
 * reads as a refusal.
 */
export async function GET(request: Request) {
  const host = normalizeHost(request.headers.get("host"));
  const loopback =
    (host === "127.0.0.1" || host === "localhost") &&
    !request.headers.has("x-forwarded-for") &&
    !request.headers.has("x-real-ip");
  if (!loopback) return new NextResponse(null, { status: 404 });

  const domain = new URL(request.url).searchParams.get("domain");
  if (domain === null || domain.trim() === "") {
    return NextResponse.json({ allowed: false }, { status: 400 });
  }

  const allowed = await canIssueCertificate(domain);
  return NextResponse.json({ allowed }, { status: allowed ? 200 : 404 });
}
