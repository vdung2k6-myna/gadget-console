import { normalizeHost } from "./request";
import { findTenantByGatewayHost } from "./resolve";

/**
 * The tenant a bridge call belongs to.
 *
 * The bridge forwards the host of the OTA or WebSocket request as
 * `x-forwarded-host`; the console resolves it against the tenant's gateway host
 * in `tenant_domains`. The bridge holds no tenant state, and a host that maps to
 * no tenant is refused before the device is touched.
 *
 * A gateway host is deliberately not a console host: the two are registered with
 * different kinds, and resolving the bridge through the console lookup would
 * answer unknown for every real OTA URL.
 */
export async function tenantForBridgeRequest(request: Request) {
  const raw = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const host = normalizeHost(raw?.split(",")[0]);
  if (host === undefined) return undefined;
  return findTenantByGatewayHost(host);
}
