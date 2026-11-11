# White-label domains and TLS

A tenant has one **console** host and one **gateway** host. The console host
serves the web console; the gateway host carries the gadget's OTA answer and
WebSocket at `/xiaozhi/ota*` and `/xiaozhi/v1*`. Both are rows in
`tenant_domains`, and Caddy issues each certificate on demand only after the
console authorizes the host.

The platform host (for example `admin.<platform-domain>`) is not a tenant host:
it serves the platform admin area and is never resolved to a tenant.

## 1. Register the hosts

A platform admin registers the two hosts for a tenant. Sign in as the platform
admin and copy the `gc_session` cookie from the browser, then:

```bash
curl -sS -X POST "https://<platform-host>/api/admin/tenants/<tenant-id>/domains" \
  -H 'content-type: application/json' \
  --cookie 'gc_session=<platform-admin-token>' \
  -d '{"domain":"console.<reseller-domain>","kind":"console"}'

curl -sS -X POST "https://<platform-host>/api/admin/tenants/<tenant-id>/domains" \
  -H 'content-type: application/json' \
  --cookie 'gc_session=<platform-admin-token>' \
  -d '{"domain":"gw.<reseller-domain>","kind":"gateway"}'
```

A host maps to one tenant across the deployment. A duplicate answers `409`; a
tenant may hold only one host of each kind. The host is stored lowercased and
without a scheme, port or trailing dot. `GET` on the same path lists the
tenant's hosts.

Register the hosts before the DNS records exist; Caddy will not ask for a
certificate until a request arrives.

## 2. Point DNS at the app host

At the DNS provider, add `A` (and `AAAA` where used) records for both names,
pointing at the app host's static address:

```
console.<reseller-domain>  A  <app-ip>
gw.<reseller-domain>       A  <app-ip>
```

Keep both records **DNS only** at Cloudflare (grey cloud). A proxied `gw` record
terminates the WebSocket the bridge advertises; a proxied console record also
breaks the hostname the console sees. Ports 80 and 443 must be open; 8001 and
8003 stay closed.

```bash
dig +short console.<reseller-domain> A
dig +short gw.<reseller-domain> A
```

Both must print the app host's address before continuing.

## 3. Install the Caddy listener

The listener is `deploy/Caddyfile.example` in this repository. It has one
`https://` site with on-demand TLS:

- Caddy calls
  `http://127.0.0.1:3001/api/internal/tenant-domains/check?domain=<host>` before
  asking the CA. The console answers 200 only for a registered host of a tenant
  that is not deleted; a suspended tenant still qualifies so its console and
  export remain reachable.
- `/xiaozhi/ota*` goes to the bridge OTA server on `127.0.0.1:8003`.
- `/xiaozhi/v1*` goes to the bridge WebSocket server on `127.0.0.1:8001`.
- Everything else goes to the console on `127.0.0.1:3001`.

Install it and validate before reloading:

```bash
sudo install -m 644 deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo journalctl -u caddy -n 30 --no-pager
```

Set `PLATFORM_HOST=<platform-host>` in the console's environment (see
`PROVISIONING.md`). It is the host that serves the platform admin area and is
never treated as a tenant host.

Caddy's certificate storage lives under `/var/lib/caddy` (the package's data
directory). Do not clear it during a reload; it holds the issued certificates
and the account key.

## 4. Verify a tenant host

From the app host, first verify the authority directly; a non-200 here means
Caddy cannot obtain a certificate for the host:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:3001/api/internal/tenant-domains/check?domain=console.<reseller-domain>'
# 200
```

From outside, verify DNS, the certificate and the console:

```bash
HOST=console.<reseller-domain>

dig +short "$HOST" A
curl -sS -o /dev/null -w 'console %{http_code}\n' "https://$HOST/"
curl -sS -o /dev/null -w 'health  %{http_code}\n' "https://$HOST/health"

openssl s_client -connect "$HOST:443" -servername "$HOST" </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -ext subjectAltName
```

The certificate's SAN must name `$HOST`, and both requests must answer 200. A
first request can take a few seconds while Caddy obtains the certificate.

Verify the gateway's OTA route (a real gadget sends `Device-Id`; without it the
bridge may answer 400, which still proves the route):

```bash
GW=gw.<reseller-domain>

curl -sS -i "https://$GW/xiaozhi/ota/" | head -20
```

An answer from the bridge — JSON or a protocol error, not a console page — is
the expected result. For the WebSocket, the documented check is a handshake
from outside:

```bash
curl -sS -i -N --http1.1 \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  "https://$GW/xiaozhi/v1/"
```

Expect `101 Switching Protocols` (the bridge may close immediately without a
valid device; the status is what matters).

Finally, confirm an unregistered host is refused rather than served:

```bash
curl -sS --resolve unknown.<reseller-domain>:443:<app-ip> \
  "https://unknown.<reseller-domain>/"
```

The TLS handshake must fail because Caddy will not obtain a certificate for a
host that is not registered. Do not expect an HTTP status.

## 5. Renewal and removal

Caddy renews every certificate it issued; no cron job or reload is needed.
On-demand issuance has CA rate limits, so register real hosts rather than
probing random names.

Removing a host from `tenant_domains` stops new certificates, but an existing
certificate remains valid until it expires. To retire a host immediately, remove
the DNS record and the tenant domain, then remove the certificate from Caddy's
storage only after the DNS change has propagated.

Deleting a tenant stops authorization for its hosts (the tenant is no longer
"not deleted") and removes its domain rows by cascade.

## 6. Troubleshooting

| Symptom | Check |
| --- | --- |
| `no certificate available` / handshake alert | ask route over loopback; Caddy log; is the host registered and the tenant not deleted? |
| Certificate issued for the platform host but not a tenant | `PLATFORM_HOST` must name only the platform host; tenant hosts go in `tenant_domains` |
| `gw` connects but the socket closes | Cloudflare proxy on `gw`; it must be DNS-only |
| OTA reaches the console instead of the bridge | the `@ota` path matcher and the bridge's 8003 listener |
| A duplicate registration answers 409 | the host belongs to another tenant; list the other tenant's domains |
| Console answers 404 on its own host | the host is not registered as `console`, or the tenant is deleted |
| Gateway host answers 404 at `/` | expected: a gateway host serves only `/xiaozhi/*` |

`docs/RUNBOOK.md` has the day-to-day commands and `docs/PROVISIONING.md` has the
fresh-host build.
