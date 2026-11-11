# Reseller adapter tokens

A tenant admin registers a private adapter and receives one opaque `adp_` token.
The platform stores only its ciphertext and a hint (`adp_…<last4>`); the plaintext
is shown once, in the response that creates or rotates it. It never appears in a
later read, an audit row or a log.

All calls use the tenant admin's `gc_session` cookie on the tenant console host.

## Register

```bash
curl -sS -X POST "https://<console-host>/api/admin/adapters" \
  -H 'content-type: application/json' \
  --cookie 'gc_session=<tenant-admin-token>' \
  -d '{"name":"<adapter name>","endpoint":"https://<adapter-host>/v1","kinds":["llm"]}'
```

The adapter is stored `pending`. The response carries `adapter` and `token`; copy
the token to the adapter now. A plain HTTP endpoint, a port other than 443, an
empty kind list or an unknown kind is refused.

## List and read

```bash
curl -sS "https://<console-host>/api/admin/adapters" \
  --cookie 'gc_session=<tenant-admin-token>'

curl -sS "https://<console-host>/api/admin/adapters/<adapter-id>" \
  --cookie 'gc_session=<tenant-admin-token>'
```

Both return the adapter with `tokenHint`, never the token. Another tenant's
adapter answers not-found.

## Rotate

```bash
curl -sS -X POST "https://<console-host>/api/admin/adapters/<adapter-id>/rotate" \
  --cookie 'gc_session=<tenant-admin-token>'
```

The response carries the new `token` once and `previousExpiresAt`. The previous
token remains valid until that time (24 hours by default), then stops.

## Disable and revoke

```bash
curl -sS -X POST "https://<console-host>/api/admin/adapters/<adapter-id>/disable" \
  --cookie 'gc_session=<tenant-admin-token>'
```

Disabling clears the current and previous tokens immediately; no later request
with either token is accepted. The row stays for re-verification; a disabled
adapter is never routed to.

## The TTS contract (v1)

```bash
POST /v1/tts/synthesize
Content-Type: application/json

{ "text": "Xin chào", "voice": "vi-female-1", "language": "vi",
  "format": "wav", "sampleRate": 24000, "rate": 1.0, "config": { "model": "..." } }
```

v1 returns **one complete audio file per request**: `200`, `Content-Type:
audio/wav` (or the declared format), `X-Audio-Format` and `X-Sample-Rate`. The
console reads the whole body, refuses a non-WAV answer when WAV was asked for,
and delivers it as one turn chunk. A `422` means the adapter cannot speak that
input; it is reported, not retried.

Streaming TTS is a future extension, not part of v1: when it is added, chunks
are `application/octet-stream` in the declared format and an adapter declares
the capability in its manifest. A v1 adapter answers one complete file and does
not stream.

`GET /v1/tts/voices` answers the voices an adapter offers:

```json
{ "voices": [{ "id": "vi-female-1", "name": "Linh",
  "languages": ["vi"], "gender": "female", "styles": ["neutral"] }] }
```

## Verification

Run `test/adapters-doc.test.ts` to check that every route and the token rules
above still match the implementation. The manifest and conformance steps that
move an adapter from `pending` to `verified` are the next tasks; until then a
registered adapter is stored but not selected.
