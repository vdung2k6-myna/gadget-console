import { headers } from "next/headers";

import { loadConfig } from "@/lib/config";
import { resolveConsoleTenant, type ResolvedTenant } from "./resolve";

/**
 * The tenant for the current server request.
 *
 * The host is what a deployed console receives. `x-tenant-path` is set by a
 * path-fallback layer (an onboarding `/t/<slug>/...` request); when it is absent,
 * the host decides. Pages and route handlers call this and refuse an unknown
 * tenant with their own not-found answer.
 */
export async function currentTenant(): Promise<ResolvedTenant> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const pathname = requestHeaders.get("x-tenant-path") ?? "/";

  return resolveConsoleTenant({
    host,
    pathname,
    platformHost: loadConfig().platformHost,
  });
}
