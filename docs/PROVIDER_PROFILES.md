# Provider profiles

A provider profile is one OpenAI-compatible endpoint **or** one registered
adapter for an LLM, an STT or a TTS provider. The console stores the profile; a
turn reaches the provider only through one.

## Shapes

| shape | what it carries | where the provider key lives |
| --- | --- | --- |
| direct (OpenAI-compatible) | absolute `baseUrl`, `model`; `voice` for `tts`; optional `temperature` for `llm` | encrypted in the profile (`encrypted_key`) |
| adapter-backed | `adapterId` and an opaque `config` object; `voice` for `tts` | in the adapter; the profile stores no key |

A profile names one shape, never both. The console refuses a draft that names
both, names neither, or breaks a kind's rule:

- `tts` always needs a non-empty voice, in either shape.
- `llm` may carry a temperature from 0 to 2.
- A direct `llm` profile needs a key; an adapter-backed one does not.
- An adapter must be registered to this tenant (or be a platform adapter) and
  must declare the profile's kind. A config that is not a JSON object is refused.

Existing direct profiles keep working unchanged: an adapterless profile is the
OpenAI-compatible path the deployment has always used.

## Scopes

| scope | `tenant_id` | `user_id` | `builtin` | who creates | who sees it |
| --- | --- | --- | --- | --- | --- |
| platform built-in | NULL | NULL | true | the operator's `PROVIDER_SEED` | every tenant |
| tenant built-in | the tenant | NULL | true | a tenant admin | that tenant's accounts |
| account-owned | the tenant | the account | false | the account | that account only |

A platform built-in has no tenant and is the deployment's provider. A tenant
built-in is a reseller's provider, published by its tenant admin. An
account-owned profile belongs to one account in one tenant. Either shape may be
built in: `publishTenantBuiltin` accepts the same adapter and config fields as an
account save.

## Visibility and selection

`listProviderProfiles(userId)` returns the account's own profiles, its tenant's
built-ins and the platform's built-ins — never another tenant's. A profile can be
named by an agent only if it is one of those.

`selectableAdaptersForUser(userId)` and `listSelectableAdapters(tenantId)` list
the adapters a profile may name: the tenant's own and the platform's, never
another tenant's.

`defaultProviderProfile(kind, tenantId)` prefers the tenant's default for the
kind, then the platform default. `defaultProviderProfileFor(userId, kind)` does
the same for the account's tenant. An account that names no profile falls to
that default; the account's own speech setting is stored by
`saveAccountProvider` and named by its agents.

## Resolution

`resolveTurnProvider(row)` resolves a stored profile to the path that answers it:

- **direct** → `{ path: "openai-compatible", baseUrl, model, apiKey?, voice?,
  temperature? }`, the shape the runtime has always called.
- **adapter-backed** → `{ path: "adapter", adapterId, endpoint, token, tenantId,
  config, voice? }`, the fields an adapter client needs. The token is decrypted
  from the adapter registry with the adapter's tenant key; the profile itself
  stores no key.

`providersForAgent` uses that resolution for the three providers in the bridge
resolve payload. A profile whose adapter is no longer visible resolves to
nothing rather than to a different provider.

## Publishing

- **Platform built-ins** come from `PROVIDER_SEED` through
  `npm run seed:providers`; they are stored with `tenant_id = NULL` and are
  idempotent by kind and name.
- **Tenant built-ins** are listed with `listTenantBuiltins` and published by a
  tenant admin with `POST /api/admin/provider-profiles` (`publishTenantBuiltin`). Names are unique
  per tenant and kind; a new default clears the previous default for that kind in
  the same tenant. `GET` lists them.
- A direct key is encrypted at rest and never returned to a browser. A tenant
  admin's built-ins are visible only through `/admin/provider-profiles`.

## UI

| page | what it does |
| --- | --- |
| `/provider-profiles` | the account's speech settings and answering-model list; built-ins are read-only |
| `/admin/provider-profiles` | the tenant admin's built-ins: list and publish |

Both provider forms offer a **Provider type**:

- **OpenAI-compatible endpoint** shows the base URL, model, a temperature for
  `llm`, and the write-only key.
- **Registered adapter** shows an adapter picker (only adapters registered to the
  tenant or the platform, and serving the selected kind) and a JSON config box.
  No base URL, model or key is asked for; the adapter holds the key.

A `tts` profile always shows its voice field, in either shape. The list views
show an adapter-backed profile by its adapter's name instead of a model.

The account speech-settings form on `/provider-profiles` still edits the direct
shape only: an adapter-backed speech profile can be stored and named, but its
test and audition need the adapter speech path, which is not wired yet.

## Isolation

Another tenant's built-ins are absent from both the list and the lookup, and
another tenant's adapters are absent from the picker. The scope tests seed two
tenants and assert that a published built-in is visible to its own tenant and not
to the other.

## Tests

- `test/tenancy-provider-profiles.test.ts` — scopes, defaults, publishing,
  duplicate names and cross-tenant invisibility.
- `test/provider-seed.test.ts` — the platform seed stores built-ins with
  `tenant_id = NULL`.
- `test/provider-profiles.test.ts` — both shapes' validation, adapter
  registration and kind checks, key removal on a shape switch, and the
  resolution the bridge receives.
- `test/bridge-api.test.ts` — the resolve route emits an OpenAI-compatible
  provider for a direct profile and the adapter's endpoint, token and config for
  an adapter-backed one.
