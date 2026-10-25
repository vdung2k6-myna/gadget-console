import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "@/lib/config";

/**
 * The bridge's own credential, compared in constant time. It is the only
 * credential `/api/bridge/*` accepts, and the only route prefix it is accepted
 * on — a browser session is not a substitute and never reaches these routes.
 */
export function bridgeAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;

  const presented = Buffer.from(header.slice(prefix.length), "utf8");
  const expected = Buffer.from(loadConfig().bridgeToken, "utf8");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
