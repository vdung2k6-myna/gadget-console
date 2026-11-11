# Roles

The console has four roles. The role is stored on the account and is read from
the account row on every request, so a change reaches the next request without a
restart.

| role | tenant scope | may | may not |
| --- | --- | --- | --- |
| `platform_admin` | none | create and suspend tenants; change roles across tenants; see tenant metadata, usage and health; open a tenant conversation only through an audited support action | read conversation text by default; be the last platform admin removed |
| `tenant_admin` | one | manage its users, devices, agents, provider profiles, firmware, claims and branding; change roles within its tenant | reach another tenant; grant `platform_admin`; remove the last tenant admin of its tenant |
| `support` | one | read its tenant's devices, turns and diagnostics | change roles, keys, billing or delete data |
| `user` | one | claim and own devices, choose a personality, read its own conversation record | reach the admin area; read another account's records |

## Guards

| guard | reaches |
| --- | --- |
| `requirePlatformAdmin` / `currentPlatformAdmin` | a platform admin only |
| `requirePlatformSurface` | a platform admin on the platform host; a tenant host answers not-found |
| `requireTenantAdminSurface` / `currentTenantAdminSurface` | an admin acting inside one tenant; a tenant host names it, otherwise the admin's own tenant |
| `requireTenantAdmin` / `currentTenantAdmin` | a tenant admin only |
| `requireSupport` / `currentSupport` | support, tenant admin or platform admin |
| `requireAdmin` / `currentAdmin` | either admin; the legacy `admin` role is accepted until the old management surface is removed |
| `canAccessTenant` | a platform admin for any tenant; every other role for its own tenant only |
| `isProtectedAdmin` | the deployment's protected accounts, which cannot be demoted from `platform_admin` |

## Resolution and sign-in

- A console host resolves its tenant through `tenant_domains`; the platform host
  is named by `PLATFORM_HOST`; an unknown host is refused.
- The path fallback `/t/<slug>/...` resolves by slug for onboarding.
- The platform area (`/admin/platform`, `/admin/platform/users`) is served only on
  the platform host: a platform admin on a tenant host gets not-found. The header
  links a platform admin there and a tenant admin to `/admin/devices`.
- Registration on a tenant console creates a `user` of that tenant. Registration
  on the platform host is refused: platform admins are created by the deployment.
- Sign-in is scoped: a tenant console signs in only its own accounts, and the
  platform host signs in only accounts whose tenant is null.

## Role management

- A tenant admin changes roles only inside its tenant, and cannot grant
  `platform_admin`.
- A platform admin changes roles across tenants; a platform admin has no tenant,
  so a demotion would need a tenant assignment the area does not provide.
- Neither admin can remove the last tenant admin of a tenant or the last platform
  admin of the platform.
- A protected admin cannot be demoted from `platform_admin`, by the area or by
  the deployment command.

## Bridge resolution

The bridge forwards the request host as `x-forwarded-host`. The console resolves
the tenant and then the device. A device that belongs to another tenant is
refused before a secret is read or a claim code is issued.

## Verification

The role constants and the access matrix are covered by `test/roles.test.ts`;
role management by `test/administration.test.ts`; tenant-scoped sign-in by
`test/tenancy-auth.test.ts`; tenant creation, suspension and cross-tenant role
management by `test/tenants.test.ts`.
