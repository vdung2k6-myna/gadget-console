# Onboarding a tenant

This is the operator's runbook for adding a reseller. It assumes the shared
deployment is already running (console, bridge, runtime, Caddy) and that you
have a platform admin account. There is no self-service tenant creation.

Placeholders: `<platform-host>`, `<tenant-slug>`, `<reseller-domain>`,
`<console-host>`, `<gateway-host>`, `<tenant-admin-email>`.

## 1. Create the tenant

Sign in as the platform admin on `<platform-host>` and open
`/admin/platform`. The create form takes a display name, a slug (lowercase
letters, digits and hyphens) and the default locale (`vi` or `en`).

The same action over HTTP:

```bash
curl -sS -X POST "https://<platform-host>/api/admin/tenants" \
  -H 'content-type: application/json' \
  --cookie 'gc_session=<platform-admin-token>' \
  -d '{"name":"<reseller display name>","slug":"<tenant-slug>","locale":"vi"}'
```

The response carries the tenant id. The tenant starts active, with no hosts and
no accounts.

## 2. Bootstrap the first tenant admin

The tenant admin is an ordinary account that the platform admin promotes. Before
the tenant's DNS exists, create the account through the path fallback:

```bash
curl -sS -X POST "https://<platform-host>/t/<tenant-slug>/api/auth/register" \
  -H 'content-type: application/json' \
  -d '{"email":"<tenant-admin-email>","password":"<strong password>"}'
```

Promote it at `/admin/platform/users`, or over HTTP:

```bash
curl -sS -X PATCH "https://<platform-host>/api/admin/users/<user-id>/role" \
  -H 'content-type: application/json' \
  --cookie 'gc_session=<platform-admin-token>' \
  -d '{"role":"tenant_admin"}'
```

The path fallback is a bootstrap surface. The browser's sign-in form posts to
the console root, so once the tenant host is live, the tenant admin signs in at
`https://<console-host>/` instead.

## 3. Register and configure the hosts

Open the tenant at `/admin/platform/tenants/<tenant-id>` and register one
console host and one gateway host; the form is under **Domains**. Or use
`POST /api/admin/tenants/<tenant-id>/domains` with
`{"domain":"<host>","kind":"console"}` (and again with `gateway`).

Then add the DNS records and install the shared Caddy listener:

- `console.<reseller-domain>` and `gw.<reseller-domain>` point at the app host's
  static address;
- keep both **DNS-only** at Cloudflare, especially the gateway;
- `deploy/Caddyfile.example` is installed once on the app host; it issues
  certificates on demand only for hosts in `tenant_domains`.

The console's `PLATFORM_HOST` names the platform host and is never a tenant
host. `docs/DOMAINS.md` has the full DNS, Caddy, certificate and verification
procedure.

## 4. Tenant settings

As the tenant admin, open `https://<console-host>/admin/settings`:

- logo, primary/accent colours, support contacts;
- default locale;
- retention days.

The platform admin sets the plan, speech allowance and quotas on
`/admin/platform/tenants/<tenant-id>`. Quotas and domains are read-only to the
tenant admin. A saved branding or locale change applies on the next page load.

## 5. Providers and adapters

`/admin/provider-profiles` lists the platform built-ins, the tenant built-ins and
the tenant's account profiles. A tenant admin publishes tenant built-ins (kind,
name, base URL, model, voice, key, default); platform built-ins are read-only.
The built-in marked default answers any agent that names none.

A tenant with its own speech or model endpoints publishes them as tenant
built-ins. The adapter chain and its verification are the
`gadget-console-remote-adapters` change; until then the built-in profile is the
selection point.

## 6. The first device

1. Flash the gadget with OTA `https://<gateway-host>/xiaozhi/ota/`.
2. Power it on and enter the six-digit code it reads out at
   `https://<console-host>/` (or the tenant's sign-up flow).
3. A tenant admin approves the claim at `/admin/claims`.
4. Create a personality for the account, then use it on the gadget.
5. Speak to it. The turn reaches the runtime and the built-in providers answer.

A claim request is refused if the device already belongs to another tenant. The
gateway host resolves to this tenant; a device owned elsewhere will not appear.

## 7. Lifecycle

`/admin/platform/tenants/<tenant-id>` carries the lifecycle controls:

- **Suspend** stops OTA and turns while keeping every row; resume restores
  service.
- **Export** downloads the tenant's users, devices, agents, claims, firmware,
  profiles, turns and usage. Password hashes, device secrets, provider keys and
  claim codes are removed. The export writes an audit row.
- **Delete** requires typing the tenant slug. It removes the tenant and every
  owned row, removes the firmware files, and writes a deletion audit row with no
  tenant so the record survives.

The tenant admin sees platform support access in `/admin/audit`.

## 8. Verification checklist

| Step | Check |
| --- | --- |
| Tenant created | appears at `/admin/platform` with status Active |
| Bootstrap account | `POST /t/<tenant-slug>/api/auth/register` answers 201 |
| Promoted | `/admin/platform/users` shows the account as Tenant admin |
| Tenant sign-in | sign in at `https://<console-host>/`; `/admin/settings` opens |
| Branding | logo, colour and support footer appear on the tenant console |
| Retention | the tenant row shows the chosen days |
| Hosts | both hosts appear on the tenant settings page and `/admin/platform/tenants/<tenant-id>` |
| Certificate | `openssl s_client` names the host; `console` answers 200 |
| Gateway | `/xiaozhi/ota/` reaches the bridge, not a console page |
| Claim | the request appears at `/admin/claims` and approval binds the device |
| Turn | the device answers, and the turn appears in the console |

## Related documents

- `docs/DOMAINS.md` — DNS, Caddy and certificate verification.
- `docs/ROLES.md` — the role matrix and the platform/tenant boundary.
- `docs/TENANCY.md` — isolation, settings, support access and lifecycle.
- `docs/DEPLOYMENT.md` — what the running deployment is.
