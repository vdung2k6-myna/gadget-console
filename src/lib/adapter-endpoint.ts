import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * An adapter endpoint must be a public HTTPS service.
 *
 * The check is made before the platform sends a token or a request: plain HTTP,
 * a non-443 port, credentials in the URL, a loopback/private/link-local address,
 * or a name that resolves to one is refused. Redirects are not followed at all
 * (`fetchAdapterManifest` uses `redirect: "error"`), which also covers the
 * cross-host case.
 */

export type EndpointRefusal =
  | "invalid-url"
  | "not-https"
  | "has-port"
  | "credentials"
  | "loopback"
  | "private"
  | "link-local"
  | "unspecified"
  | "multicast"
  | "resolved-private"
  | "dns-failure";

export type EndpointValidation =
  | { ok: true; url: URL; addresses: string[] }
  | { ok: false; reason: EndpointRefusal; detail?: string };

function ipv4Reason(address: string): EndpointRefusal | undefined {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return "invalid-url";
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
    return "private";
  }
  if (a === 169 && b === 254) return "link-local";
  if (a >= 224) return "multicast";
  return undefined;
}

function ipv6Reason(address: string): EndpointRefusal | undefined {
  const value = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped !== null) return ipv4Reason(mapped[1]!);
  if (value === "::") return "unspecified";
  if (value === "::1") return "loopback";
  const first = Number.parseInt(value.split(":")[0] ?? "", 16);
  if ((first & 0xffc0) === 0xfe80) return "link-local";
  if ((first & 0xfe00) === 0xfc00) return "private";
  if ((first & 0xff00) === 0xff00) return "multicast";
  return undefined;
}

/** A forbidden address, or undefined when it is public. */
export function forbiddenAddress(address: string): EndpointRefusal | undefined {
  const bare = address.replace(/^\[|\]$/g, "");
  const family = isIP(bare);
  if (family === 4) return ipv4Reason(bare);
  if (family === 6) return ipv6Reason(bare);
  return "invalid-url";
}

type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: Resolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function validateAdapterEndpoint(
  endpoint: string,
  options: { resolve?: Resolver; timeoutMs?: number } = {}
): Promise<EndpointValidation> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "not-https" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "credentials" };
  if (url.port !== "" && url.port !== "443") return { ok: false, reason: "has-port" };

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return { ok: false, reason: "loopback" };
  }

  if (isIP(hostname) !== 0) {
    const literal = forbiddenAddress(hostname);
    if (literal !== undefined) return { ok: false, reason: literal };
  }

  const resolve = options.resolve ?? defaultResolver;
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await Promise.race([
      resolve(hostname),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("dns timeout")), options.timeoutMs ?? 5000).unref();
      }),
    ]);
  } catch {
    return { ok: false, reason: "dns-failure" };
  }
  if (addresses.length === 0) return { ok: false, reason: "dns-failure" };

  for (const entry of addresses) {
    const reason = forbiddenAddress(entry.address);
    if (reason !== undefined) {
      return { ok: false, reason: "resolved-private", detail: entry.address };
    }
  }
  return { ok: true, url, addresses: addresses.map((entry) => entry.address) };
}

/** A redirect is acceptable only to the same HTTPS host. */
export function redirectAllowed(from: string, to: string): boolean {
  try {
    const source = new URL(from);
    const target = new URL(to);
    return (
      source.protocol === "https:" &&
      target.protocol === "https:" &&
      source.hostname.toLowerCase() === target.hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}
