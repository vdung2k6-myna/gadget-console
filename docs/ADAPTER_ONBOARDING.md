# Onboarding a reseller adapter

A reseller hosts the adapter; the console is its client. This is the whole
sequence, in the order the console allows it. Contract v1 is fixed: manifests,
requests and events are the ones in `docs/ADAPTERS.md`, and the conformance
checklist is in `docs/ADAPTER_CONFORMANCE.md`.

## 1. Register the endpoint and keep the token

```bash
curl -sS -X POST "https://<console-host>/api/admin/adapters" \
  -H 'content-type: application/json' \
  --cookie 'gc_session=<tenant-admin-token>' \
  -d '{"name":"<adapter name>","endpoint":"https://<adapter-host>/v1","kinds":["llm","stt","tts"],
       "privacy":{"operator":"<operator>","region":"<region>","receives":["text","audio"],"remote":true}}'
```

The endpoint must be HTTPS on port 443, resolve publicly, and not be loopback,
private or link-local. The response carries `adapter` and `token`; the token is
`adp_…` and is shown once. Store it at the adapter now. The row is `pending` and
no turn routes to it.

A token may be rotated (`POST /api/admin/adapters/<id>/rotate`); the old one is
accepted for the overlap window. Disabling (`POST /api/admin/adapters/<id>/disable`)
revokes both immediately.

## 2. Implement the contract

The adapter exposes, under its registered endpoint:

| path | what it answers |
| --- | --- |
| `GET /v1/manifest` | contract 1, id, version, kinds, capabilities, config schema, privacy, limits |
| `GET /v1/health` | `200 {"status":"ok"}` |
| `POST /v1/llm/chat` | an SSE stream of `text`, `tool_call`, `usage`, `done` |
| `POST /v1/stt/transcribe` | multipart audio → `{text, language, confidence, segments?}` |
| `POST /v1/tts/synthesize` | one complete audio file per request |
| `GET /v1/tts/voices` | the voices it offers |

Every call carries `Authorization: Bearer adp_…`, `X-Adapter-Id`,
`X-Tenant-Id`, `X-Contract-Version: 1` and `X-Request-Id`. An absent or wrong
token answers `401`; a mismatched tenant or adapter answers `403`. Audio over a
declared limit answers `422 unsupported`. The details are in `docs/ADAPTERS.md`.

## 3. Fetch the manifest

The console fetches `/v1/manifest` and refuses an unsupported contract version,
a missing kind capability, or a malformed privacy or limits object. A manifest
version change invalidates verification: the adapter returns to `pending` until
the checks run again.

## 4. Conformance and the Vietnamese benchmark

`runConformance` exercises auth, manifest, health, the LLM stream, tools,
cancellation, error mapping, STT and TTS. `runVietnameseBenchmark` records WER,
TTS naturalness (supplied by a reviewer), and p50/p95 latency against the
adapter row. Both are run by the operator against the registered adapter and its
token; a failing case names itself.

A speech adapter must pass the hard floor to serve Vietnamese: STT WER ≤ 0.15,
TTS naturalness ≥ 3.0. A below-floor adapter may serve other languages and is
never the Vietnamese path.

## 5. Enable

Only after the manifest, conformance and benchmark pass is the row moved to
`verified` (`updateAdapterStatus(tenantId, id, "verified")`, reachable from the
operator's tooling; the tenant admin's page shows the status and health). Until
then it stays `pending` or `disabled` and the chain resolver excludes it.

## 6. Select it

A tenant admin puts the adapter in a provider profile or in the tenant's routing
policy:

- a profile names the adapter and its opaque config (`/provider-profiles`);
- the policy sets `localOnly`, the ordered fallback list and a monthly budget
  (`/admin/adapters`).

For a Vietnamese speech turn, a verified adapter above the floor is used only
when the profile explicitly names it; otherwise the platform's speech provider
answers.

## The bridge

The bridge needed no new endpoint and no contract of its own: it carries the
console's resolved `providerChain` (one opaque JSON field per turn) unchanged and
forwards the runtime's `adapter` usage events. It reads no token beyond
transporting it in the turn body, and logs none.

## Verify these steps

`test/adapters-doc.test.ts` checks that this guide and the contract guide still
name the routes and the one-time token rule. `test/tenant-adapters.test.ts`
exercises registration, rotation, revocation, manifest changes, conformance, the
benchmark and the floor against stub adapters, and `test/adapter-chain.test.ts`
(in the runtime) takes one turn through all three kinds.
