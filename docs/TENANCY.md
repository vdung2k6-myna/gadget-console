# Tenancy enforcement

A tenant is a reseller's slice of the deployment. Every owned row carries a
`tenant_id`; the platform built-ins are the only tenantless rows. The boundary is
enforced in layers, from the most specific to the widest.

## 1. Repository context

`src/lib/tenancy/repository.ts` is the read surface for owned data. Every
function starts with `asTenantContext`, which throws `a tenant context is
required` for a missing or empty tenant. A caller cannot ask for "all tenants"
by omission.

| function | rows |
| --- | --- |
| `findDeviceByDeviceId`, `findDeviceRow`, `listDevices` | devices |
| `findAgent`, `listAgents` | agents |
| `findProviderProfile`, `listBuiltInProfiles` | provider profiles |
| `findClaimByDeviceId`, `listClaims` | claims |
| `listTurns` | turns |
| `listFirmware` | firmware releases |
| `listUsage` | usage events |

`ownedBy(table, context)` is the shared predicate for a query written elsewhere.

## 2. Two-tenant matrix

`test/tenancy-isolation.test.ts` seeds two tenants with one row of each owned
entity and asserts that a context for one tenant never returns the other's row.
It also calls every repository function without a context and expects a refusal.

## 3. Platform built-ins

Platform built-ins have `tenant_id = NULL` and `builtin = true`. They are the one
exception: `listBuiltInProfiles` returns them alongside the calling tenant's own
built-ins, and never another tenant's built-ins. The matrix covers this in its
third case.

## 4. Row-level security (planned)

The repository is the application layer. Postgres RLS is the defense-in-depth
layer and is not enabled yet:

1. a policy on every owned table compares `tenant_id` to
   `current_setting('app.tenant_id')`;
2. the repository sets it with `SET LOCAL app.tenant_id` at the start of each
   transaction;
3. the pool returns the connection to a clean state, so the setting cannot leak
   across requests.

The pooling caveat is why this is a separate step: a session-level `SET` on a
pooled connection would leak the tenant to the next borrower. The repository's
throw-without-context rule is what keeps the application safe until RLS lands.

## Usage and allowance

`usage_events` records platform speech and reseller speech separately with its
`source`. `recordUsage` writes one event; `usageReport(tenantId, { since })` sums
the speech seconds in the window and returns:

```
platformSeconds   metered, and the only seconds that can be billed
resellerSeconds   recorded for the tenant view; never billed by the platform
allowanceSeconds  the tenant's speech_allowance_seconds, or an override
overageSeconds    max(0, platformSeconds - allowanceSeconds)
billableSeconds   overageSeconds
```

The report returns seconds; the commercial rate turns the overage into money.
`test/tenancy-usage.test.ts` covers the allowance, the overage, an explicit
override and the unbilled reseller path. The runtime that reports the seconds on
a live turn is the adapter/speech integration (`10.x`).

## Quotas

`tenants.quotas` bounds `devices`, `turns`, `concurrency`, `speechSeconds` and
`providerSpend`; an absent key means no bound. `checkQuota` returns a refusal
that names the tenant and the quota, and `quotaRefusalMessage` turns it into the
sentence the console or bridge answers with.

- A new device is checked against the device quota before its row is created;
  an owned device's connection is checked against the 24-hour turn quota.
- Speech seconds are summed from `usage_events`; provider spend and concurrency
  are checked against a caller-supplied used value. The runtime that would report
  those values is the metering task (6.4).
- `test/tenancy-quotas.test.ts` covers the checks, the device and turn
  enforcement, and the speech-second sum.

## Retention

Each tenant's `retention_days` overrides the deployment's `RETENTION_DAYS` for
its turns. The scheduled `pruneAll` iterates tenants and deletes each tenant's
turns on its own cutoff; a tenant that states no retention follows the
deployment's, and rows that predate tenancy follow it too. The unclaimed-device
and claim TTLs remain deployment settings. `test/tenancy-retention.test.ts` seeds
two tenants with different values and checks what each pass removes.

## Keys

`LLM_KEY_SECRET` is the deployment's master key. A platform built-in is encrypted
with it; every tenant-scoped provider key is encrypted with a data key derived
for that tenant with HKDF. A wrong tenant's key fails GCM authentication, so one
tenant's key cannot read another's secret; destroying a tenant's data key leaves
the rest of the deployment untouched.

A row written before tenancy is encrypted with the master key. After the pilot
backfill has assigned tenants, move those rows with:

```bash
npm run migrate:tenancy-keys -- --dry-run
npm run migrate:tenancy-keys
```

The pass skips a row already under its tenant key, re-encrypts a master-key row,
and reports a row that neither key opens as failed. The key derivation and the
migration are covered by `test/tenancy-keys.test.ts`.

## Writes and NOT NULL

The write paths set `tenant_id` from the resolved tenant. The columns stay
nullable until every insert path and test fixture supplies one; the NOT NULL
migration then follows (task 1.4). A nullable column during the migration is a
transition, not the target.

## Resolution

A console host resolves its tenant through `tenant_domains`; the platform host is
`PLATFORM_HOST`; the path fallback is `/t/<slug>`. The bridge forwards the device
request's host as `x-forwarded-host`, and a device that belongs to another tenant
is refused before a secret or claim code is issued.

## Domains

`registerTenantDomain(tenantId, { domain, kind })` registers a console or gateway
host. The host is normalized like a request host (lowercased, scheme, port and
trailing slash removed), and `tenant_domains.domain` is unique across the
deployment, so a duplicate host is refused with `domain-taken` even when the same
tenant registers it again. The `(tenant_id, kind)` uniqueness allows one console
and one gateway host per tenant; a second host of the same kind is `kind-taken`.
Registration is on the platform admin surface at
`/api/admin/tenants/<id>/domains`.

`src/proxy.ts` routes a console request. A registered console host passes; an
unregistered host answers 404 unless it is the platform host, loopback, or the
deployment states no `PLATFORM_HOST` (a single-tenant or local console). The
`/t/<slug>/...` fallback is rewritten to the same path with `x-tenant-path` set
for `currentTenant`, and the header is stripped from every other request so a
browser cannot pick a tenant.

The bridge resolves its tenant from a **gateway** host, not a console host:
`findTenantByGatewayHost` is the lookup, so a real `gw.<domain>` OTA URL resolves
and a console host does not.

TLS is issued on demand. Caddy asks
`http://127.0.0.1:3001/api/internal/tenant-domains/check?domain=<host>`; the route
answers 200 only for a registered host of a tenant that is not deleted (suspended
still qualifies so its console and export remain reachable), and 404 otherwise.
`deploy/Caddyfile.example` is the listener: one HTTPS front for console, platform
and gateway hosts, with `/xiaozhi/ota*` to the bridge's OTA port and
`/xiaozhi/v1*` to its socket port. `docs/DOMAINS.md` is the operator procedure for
registering hosts, DNS, installing the listener and verifying a tenant host.

## Branding

A tenant's `branding` JSON carries `logoUrl`, `primaryColor`, `accentColor`,
`supportEmail`, `supportUrl` and `supportPhone`. `validateTenantDraft` refuses an
unknown field, a non-hex colour, an unsafe logo (anything but an http(s) URL or a
same-origin path) and a malformed contact. `tenantBranding` re-reads the stored
object for rendering and falls back field by field, so a row written before
validation existed cannot inject a URL or a colour.

The root layout applies it: the logo replaces the console name (or the tenant's
name takes the primary colour), the header rule and support links take the
tenant's colours, and the footer lists the contacts the tenant states. The
tenant's `locale` is the default language for its host; a person's language
cookie still wins. `test/tenancy-branding.test.ts` covers validation, read-time
sanitizing, the locale precedence and the rendered markup.

## Tenant settings

`/admin/settings` lets a tenant admin change branding, its default locale and
retention. The platform's `/admin/platform/tenants/<id>` changes the plan,
speech allowance, quotas, retention and locale, and registers domains. Quotas
and domains are read-only to the tenant admin; a settings save cannot raise a
quota. `test/tenant-settings.test.ts` covers validation, the merge that leaves
quotas and plan alone, and the applied quota.

## Support access

A platform admin sees a tenant device's metadata but not its conversation.
`/admin/support/<device>` offers one explicit action; taking it inserts an
`audit_events` row with action `support.conversation.open`, the actor, the tenant
and the device, and returns a fifteen-minute grant. The page serves turns only
when the grant names the same actor and device and has not expired. A tenant
admin reads the rows at `/admin/audit`; `test/support-access.test.ts` covers the
scope, the row and the expiry.

## Tests

| layer | test |
| --- | --- |
| repository context and two-tenant matrix | `test/tenancy-isolation.test.ts` |
| tenant admin reads, claims, firmware and profiles | `test/tenant-admin.test.ts` |
| support access scope, audit and expiry | `test/support-access.test.ts` |
| host and path resolution | `test/tenancy-resolve.test.ts` |
| domain registration and uniqueness | `test/tenancy-domains.test.ts` |
| certificate authorization | `test/tenancy-domain-check.test.ts` |
| tenant routing | `test/tenancy-routing.test.ts` |
| branding and locale | `test/tenancy-branding.test.ts` |
| bridge resolution scoping | `test/bridge-api.test.ts` |
| role and tenant management | `test/roles.test.ts`, `test/administration.test.ts`, `test/tenants.test.ts` |
