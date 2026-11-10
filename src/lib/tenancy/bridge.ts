import { resolveConsoleTenant } from "./resolve";

/**
 * The tenant a bridge call belongs to.
 *
 * The bridge forwards the host of the OTA or WebSocket request as
 * `x-forwarded-host`; the console resolves it against `tenant_domains`. The
 * bridge holds no tenant state, and a host that maps to no tenant is refused
 * before the device is touched.
 */
export async function tenantForBridgeRequest(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const resolved = await resolveConsoleTenant({ host, pathname: "/" });
  return resolved.kind === "tenant" ? resolved.tenant : undefined;
}
