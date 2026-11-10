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
`/api/admin/tenants/<id>/domains`. DNS and TLS are the next step.

## Tests

| layer | test |
| --- | --- |
| repository context and two-tenant matrix | `test/tenancy-isolation.test.ts` |
| host and path resolution | `test/tenancy-resolve.test.ts` |
| domain registration and uniqueness | `test/tenancy-domains.test.ts` |
| bridge resolution scoping | `test/bridge-api.test.ts` |
| role and tenant management | `test/roles.test.ts`, `test/administration.test.ts`, `test/tenants.test.ts` |
