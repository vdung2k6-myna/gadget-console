# Provider profiles

A provider profile is one OpenAI-compatible endpoint for an LLM, an STT or a TTS
provider. The console stores the endpoint, model, voice and an encrypted key; a
turn reaches the endpoint only through a profile.

## Scopes

| scope | `tenant_id` | `user_id` | `builtin` | who creates | who sees it |
| --- | --- | --- | --- | --- | --- |
| platform built-in | NULL | NULL | true | the operator's `PROVIDER_SEED` | every tenant |
| tenant built-in | the tenant | NULL | true | a tenant admin | that tenant's accounts |
| account-owned | the tenant | the account | false | the account | that account only |

A platform built-in has no tenant and is the deployment's provider. A tenant
built-in is a reseller's provider, published by its tenant admin. An
account-owned profile belongs to one account in one tenant.

## Visibility and selection

`listProviderProfiles(userId)` returns the account's own profiles, its tenant's
built-ins and the platform's built-ins — never another tenant's. A profile can be
named by an agent only if it is one of those.

`defaultProviderProfile(kind, tenantId)` prefers the tenant's default for the
kind, then the platform default. `defaultProviderProfileFor(userId, kind)` does
the same for the account's tenant. An account that names no profile falls to
that default; the account's own speech setting is stored by
`saveAccountProvider` and named by its agents.

## Publishing

- **Platform built-ins** come from `PROVIDER_SEED` through
  `npm run seed:providers`; they are stored with `tenant_id = NULL` and are
  idempotent by kind and name.
- **Tenant built-ins** are listed with `listTenantBuiltins` and published by a
  tenant admin with `POST /api/admin/provider-profiles` (`publishTenantBuiltin`). Names are unique
  per tenant and kind; a new default clears the previous default for that kind in
  the same tenant. `GET` lists them.
- The key is encrypted at rest and never returned to a browser. A tenant admin's
  built-ins are visible only through `/admin/provider-profiles`.

## UI

| page | what it does |
| --- | --- |
| `/provider-profiles` | the account's speech settings and answering-model list; built-ins are read-only |
| `/admin/provider-profiles` | the tenant admin's built-ins: list and publish |

## Isolation

Another tenant's built-ins are absent from both the list and the lookup. The
scope tests seed two tenants and assert that a published built-in is visible to
its own tenant and not to the other.

## Tests

- `test/tenancy-provider-profiles.test.ts` — scopes, defaults, publishing,
  duplicate names and cross-tenant invisibility.
- `test/provider-seed.test.ts` — the platform seed stores built-ins with
  `tenant_id = NULL`.
- `test/provider-profiles.test.ts` — account-owned profile validation and the
  legacy single-deployment fallback.
