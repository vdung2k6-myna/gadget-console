import { NextResponse, type NextRequest } from "next/server";

import { loadConfig } from "@/lib/config";
import { normalizeHost, parseTenantRequest } from "@/lib/tenancy/request";
import { findTenantByConsoleHost } from "@/lib/tenancy/resolve";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * The console's tenant routing.
 *
 * A tenant console is served on its own host. A request on a host that maps to
 * no tenant is refused here rather than rendered with the wrong tenant's data;
 * the platform host is the one exception. With no `PLATFORM_HOST` the deployment
 * is a single-tenant or local console, and the guard is off so it keeps serving.
 *
 * `/t/<slug>/...` is the onboarding and development fallback: it is rewritten to
 * the same path with the tenant path in `x-tenant-path`, which `currentTenant`
 * reads. The header is stripped from every request first, so a browser cannot
 * select a tenant by sending it.
 */
export default async function proxy(request: NextRequest) {
  const deployment = loadConfig();
  const rawHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const host = normalizeHost(rawHost?.split(",")[0]);
  const parsed = parseTenantRequest({
    host,
    pathname: request.nextUrl.pathname,
    platformHost: deployment.platformHost,
  });

  const headers = new Headers(request.headers);
  headers.delete("x-tenant-path");

  // The bridge resolves its own tenant from the forwarded gateway host, and the
  // health check is reached over loopback. Neither is a console page.
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/bridge") || pathname === "/health") {
    return NextResponse.next({ request: { headers } });
  }

  if (parsed.kind === "tenant" && parsed.source === "path") {
    const url = request.nextUrl.clone();
    url.pathname = parsed.pathname;
    headers.set("x-tenant-path", request.nextUrl.pathname);
    return NextResponse.rewrite(url, { request: { headers } });
  }

  if (parsed.kind === "platform") {
    return NextResponse.next({ request: { headers } });
  }

  if (parsed.kind === "tenant" && parsed.source === "host") {
    const tenant =
      parsed.host === undefined ? undefined : await findTenantByConsoleHost(parsed.host);
    if (tenant !== undefined) return NextResponse.next({ request: { headers } });
    return new NextResponse(null, { status: 404 });
  }

  const local =
    host !== undefined &&
    LOCAL_HOSTS.has(host) &&
    !request.headers.has("x-forwarded-for");
  if (deployment.platformHost === null || local) {
    return NextResponse.next({ request: { headers } });
  }

  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
