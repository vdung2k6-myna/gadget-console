/**
 * Whether a request reached the console over loopback.
 *
 * Next sets `x-forwarded-for` on a local request to the socket address
 * (`::ffff:127.0.0.1`), while Caddy appends the public client address when it
 * proxies one. A local request is therefore one whose forwarded chain contains
 * only loopback entries; a client that spoofs a loopback entry is still refused
 * because Caddy appends its real address to the chain.
 */

export function isLoopbackHost(host: string | undefined): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function isLoopbackAddress(value: string): boolean {
  const address = value.trim().toLowerCase();
  return (
    address === "127.0.0.1" ||
    address === "localhost" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

export function isLoopbackForwarded(headers: Headers): boolean {
  const chain = headers.get("x-forwarded-for");
  if (chain !== null && chain.trim() !== "") {
    if (!chain.split(",").every(isLoopbackAddress)) return false;
  }

  const real = headers.get("x-real-ip");
  if (real !== null && real.trim() !== "" && !isLoopbackAddress(real)) return false;

  return true;
}

export function isLoopbackRequest(
  host: string | undefined,
  headers: Headers
): boolean {
  return isLoopbackHost(host) && isLoopbackForwarded(headers);
}
