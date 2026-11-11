# gadget-console

The console for people who own XiaoZhi voice gadgets: accounts, devices, the
personalities that answer them, claims, the record of what was said, and a guide for
the person holding the gadget.

It owns the only database in the product. The bridge (`gadget-bridge`) holds no
database and asks this service, over HTTP, for everything a session needs.

It speaks Vietnamese and English, chosen per browser from the header.

## Running it

Node **22 or newer**, and a Postgres it can create a database on.

```bash
npm install
cp .env.example .env      # then set DATABASE_URL, BRIDGE_TOKEN and LLM_KEY_SECRET
npm run db:migrate        # creates the schema
npm run seed:runtime      # the runtime an agent can point at
npm start                 # http://127.0.0.1:3001
```

The port is 3001 rather than Next's 3000 on purpose: the interview client already
owns 3000 on a development machine. It is set by the npm scripts, because
`next start` reads `PORT` before it loads `.env`.

| Command | What it does |
| --- | --- |
| `npm start` / `npm run dev` | The service, on 3001. |
| `npm run build` | A production build. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | The suite (`tsx --test`, against `TEST_DATABASE_URL`). |
| `npm run db:generate` | A migration from the schema. |
| `npm run db:migrate` | Apply migrations. |
| `npm run seed:runtime` | Seed the runtime an agent points at (idempotent by name). |
| `npm run seed:providers` | Publish the deployment's built-in `stt`, `tts` and `llm` providers from `PROVIDER_SEED` (idempotent; never deletes). |
| `npm run prune` | Delete what is past its time now: unowned devices, dead claims, old turns. |
| `npm run role -- <email> <user\|admin>` | Grant or take away the admin role. |
| `npm run ops -- …` | The operator tool: `status`, `deploy <service>`, `session start\|stop`. It needs `ops.local.json` (gitignored); see `docs/RUNBOOK.md`. |

## Configuration

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | The database this service owns. |
| `BRIDGE_TOKEN` | yes | The credential the bridge presents on `/api/bridge/*`. |
| `LLM_KEY_SECRET` | yes | Encrypts every saved provider key — an account's or a built-in's — 32 bytes base64. Losing it makes every saved profile undecryptable. |
| `SESSION_TTL_MS` | no | How long a browser session lives (30 days). |
| `CLAIM_TTL_MS` | no | How long a claim code is good for (10 minutes). |
| `CLAIM_APPROVAL_TTL_MS` | no | How long an entered request waits for an admin before it is abandoned (24 hours). |
| `RETENTION_DAYS` | no | How long a turn is kept (90 days). |
| `UNCLAIMED_DEVICE_TTL_MS` | no | How old a device row nobody owns must be before it may be removed (7 days). |
| `PRUNE_INTERVAL_MS` | no | How often the cleanup runs (6 hours). `0` turns the timer off. |
| `PRUNE_BATCH` | no | Rows one cleanup removes per kind (1 000), so a backlog drains over several passes. |
| `TEST_DATABASE_URL` | for tests | A separate database; the tests truncate it. |
| `RUNTIME_TOKEN` | for seeding | The credential `seed:runtime` stores, with `RUNTIME_NAME` (default `interview`), `RUNTIME_URL`, `RUNTIME_ENGINES`, `RUNTIME_LANGUAGES`. |
| `PROVIDER_SEED` | for seeding | A JSON array of built-ins: `kind` (`stt`, `tts` or `llm`), `name`, `baseUrl`, `model`, `voice` for `tts`, an optional `apiKey` and `temperature` for `llm`, and `default`. |
| `FIRMWARE_DIR` | for releases | Where firmware images are kept. Unset means an upload is refused rather than written somewhere nobody backs up. |
| `CONSOLE_PUBLIC_URL` | for releases | The address a gadget reaches this console at, used to build a download URL. Unset means releases can be stored but none is delivered. |
| `FIRMWARE_MAX_BYTES` | no | The largest image the console will store (8 MiB). |

## The data

| Table | What it holds |
| --- | --- |
| `users`, `sessions` | Accounts (with their role), and the hash of each live session token. |
| `runtimes` | A base URL, a credential, and the engines and languages it names. |
| `provider_profiles` | Built-in or account-owned `llm`, `stt` and `tts` endpoints: base URL, model, a TTS voice, an encrypted key, and the deployment-default flag. Built-ins are seeded and read-only. |
| `agents` | Prompt, topics, answer mode, language, engine, runtime, the voice it may name, and its voice conversion. A device names one agent; the console presents agents as personalities. |
| `devices` | A gadget: its identifier, its own secret, its owner, its agent, its partner, the tool catalogue its firmware reported, and what it reported about its own board. |
| `firmware_releases` | A firmware image per board type and version, which one is its board type's target, and whether that target is forced. |
| `claims` | A short code, its expiry, the account that entered it, and when an admin approved or refused it. |
| `conversations`, `turns` | What was said, as text; no audio is stored. |

A device row exists **before** it has an owner, because the firmware connects with
the token it was given before activation. Its first OTA request creates the row and
a secret; claiming sets the owner; releasing clears the owner, replaces the secret,
and deletes the record.

### Cleanup

Three things are deleted on a schedule, so that neither a gadget nor a caller can
make the tables grow forever:

- **Unowned device rows** older than `UNCLAIMED_DEVICE_TTL_MS`, together with their
  claims. A row is kept while anything on it can still be acted on: a code that has
  not expired, or a code an account entered and an admin has not decided within
  `CLAIM_APPROVAL_TTL_MS`. A row with an owner is never touched.
- **Claims** whose code is dead and whose request is decided or past that same
  approval period.
- **Turns** past `RETENTION_DAYS`.

The run starts with the service and repeats every `PRUNE_INTERVAL_MS`, deleting at
most `PRUNE_BATCH` rows of each kind per pass — a backlog drains over several
passes instead of locking the table once. The first pass comes about fifteen
seconds after the service starts, so a deployment that restarts often still
cleans up. It logs one line, `[retention] pruned devices=… claims=… turns=…`.
`npm run prune` runs it once by hand; with `PRUNE_INTERVAL_MS=0` the timer is off
and that command is the only way it runs.

## Accounts and roles

Every account is a `user` or an `admin`. A new account is a user.

- **The admin area** at `/admin` lists every account's devices (with the owner),
  every account with what it owns, the claim requests waiting for a decision, and
  any device's page — its conversation included — with the same actions an owner
  has.
- **The role is granted** by `npm run role -- <email> admin`, or by an admin from
  `/admin/users`. No account can make itself an admin: a user calling any of those
  routes gets the not-found answer.
- **The last admin cannot be removed**, so the area cannot be locked out by a
  click.
- **A protected admin is configured, not coded.** Addresses listed in
  `PROTECTED_ADMINS` — a deployment setting, comma separated — can never be
  returned to a user, by the command or by the admin area. Empty by default, so
  the repository carries no account; `scripts/role.ts` and the admin UI both
  refuse these accounts.
- Every change an admin makes to another account's gadget, and every role change,
  writes one `[admin] …` line naming the admin, the target and what was done.

Admins do **not** see an account's LLM profiles or keys: those are the account's
own credentials, not a gadget.

An owner does not configure providers. The deployment publishes built-in `stt`,
`tts` and `llm` profiles; an owner's turns use them, and the personality form
offers no provider field. An administrator manages the built-ins with
`npm run seed:providers` — the provider page lists them read-only — and an admin
account may still configure its own speech settings for its own agents.

## Screens

| Page | What it shows |
| --- | --- |
| `/` | Sign in, or create an account. Signed-in visitors are sent to their home. |
| `/devices` | The owner's home: the claim steps when there is nothing yet, then a card per gadget with its active personality, when it was last seen, and the switch to another personality. A claim awaiting an admin shows as a waiting step. |
| `/devices/[id]` | One gadget: identifier, personality, partner, last seen, the board its firmware reported and the release targeted for it, what it can do; rename, bind, pair, release; and its conversation record. |
| `/agents` | Personalities: cards with a plain description, language, voice, the gadgets each answers, a preview and a "use on a gadget" action. |
| `/agents/new`, `/agents/[id]` | The personality form. “Create a personality” carries a name, language, voice and voice style (OVC); Hear it previews it and Save leaves it unassigned. Assignment is on its card: “Use on gadget” → choose the gadget. `/agents/new?gadget=<id>` is the device shortcut: it loads that gadget's current voice and style; an OVC change saves a copy for that gadget. |
| `/provider-profiles` | **Administrator only.** The deployment's built-in providers (read-only), the admin account's speech settings, and its answering models. A user gets the not-found page. |
| `/help` | The guide: every step from unboxing to release, and what each common failure means. |
| `/admin/devices`, `/admin/users`, `/admin/claims` | The tenant admin area: every device, every account, and the requests waiting for a decision in this tenant. Visible in the header only to an admin. |
| `/admin/agents` | Every personality in the tenant, with its owner, language and voice. |
| `/admin/platform`, `/admin/platform/users` | **Platform admin only, on the platform host.** Every tenant with its status, hosts and 30-day usage, plus every account grouped by tenant with its role. A tenant host answers not-found. |
| `/admin/firmware` | The firmware releases, with an upload form, the target for each board type, and the controls that move or clear it. |
| `/admin/devices/[id]` | Any gadget, with its speech calibration: the pair it uses, whether it comes from the device or the default, and an edit and reset-to-default. A change applies when the gadget next connects. |
| `/admin/calibration` | The deployment's default speech-gate pair, for devices that have not calibrated their own. |

A walk through it, in order:

1. Open `http://127.0.0.1:3001/` and create an account.
2. Power a gadget. Its OTA answer carries a code; it shows and speaks the six digits.
3. Enter the code on the home. That is a **request**: it waits for an admin's approval,
   and the home says it is being reviewed.
4. Once approved, gadget appears. Create a personality (name, language, voice,
   voice style), use "Hear it", save, then on its card choose the gadget and press
   "Use this personality".
5. The gadget answers with the chosen personality. Its card switches to another
   personality at any time.
6. Speak to the gadget. The turn appears under "Hội thoại" on its page, and the tools
   the gadget declared appear under "Thiết bị này làm được".
7. Releasing the gadget on the same page deletes that record and makes the gadget
   claimable again through a new code.

The deployment provides the voices and the answering model. An owner types no
endpoint, model or key: the personality is created on the owner's own agent with a
neutral name and prompt for its language, and that agent answers on the deployment's built-ins. An administrator seeds those
built-ins with `npm run seed:providers` and may configure the admin account's own
speech settings; a user's browser has no route that edits a built-in.

## Voice conversion per agent

An agent may inherit the deployment's voice conversion, opt out of it entirely,
or carry its own shaping. The config lives on `agents.ovc_config`: `null`
inherits, `{"enabled":false}` makes no conversion request at all, and an object
(pitch, formant, F0 method, advanced model knobs, effects) shapes the
deployment's active model. The conversion voice itself is the deployment's, not
an agent choice.

Deploy order: the runtime first, because it must understand `{"enabled":false}`
before the console offers it; then this console's migration and form; then the
bridge's forwarding. Rolling back the bridge's `ovc` field returns every agent to
inherit — the stored configs stay and are inert. See the runtime's
`docs/API.md` for the field's validation.

## Languages

The interface is Vietnamese by default and English when chosen. The choice is a
cookie (`gc_locale`, a year, httpOnly), set by the header switcher through
`POST /api/locale`; there is no `/[locale]` segment, because these pages are behind
a session and are neither shared nor indexed. The active dictionary is rendered on
the server, and `<html lang>` follows it. Data — device names, prompts, runtime
names, provider messages — is never translated.

## Routes

Browser routes use the httpOnly session cookie. `/api/bridge/*` uses
`Authorization: Bearer $BRIDGE_TOKEN` and nothing else — a browser session never
reaches them. `/api/admin/*` requires an admin role; anybody else gets the
not-found answer.

| Route | Who | What it does |
| --- | --- | --- |
| `POST /api/auth/register` | browser | Create an account and sign in. |
| `POST /api/auth/login` / `logout` | browser | Sign in / out. |
| `POST /api/locale` | browser | Remember the chosen language. |
| `GET /api/devices` | browser | The account's devices. |
| `PATCH /api/devices/:id` | browser | Rename, bind an agent, pair a partner. |
| `DELETE /api/devices/:id` | browser | Release the gadget. |
| `GET /api/devices/:id/turns` | browser | Its conversation record, most recent first. |
| `GET/POST /api/agents`, `PATCH/DELETE /api/agents/:id` | browser | Personalities. An owner's save may name only a built-in profile; with none named, the route fills the deployment's built-ins. |
| `POST /api/agents/voice-conversion/audition` | browser | Speak a short sample through the built-in (owner) or named (admin) TTS profile and the runtime's conversion; returns WAV. |
| `GET/POST /api/provider-profiles`, `PATCH/DELETE /api/provider-profiles/:id` | admin | The deployment's built-ins (read-only) and the account's own provider profiles. |
| `GET/PUT /api/provider-settings`, `POST /api/provider-settings/test` | admin | The account's speech settings and a test against the endpoint typed in the form. |
| `POST /api/claims` | browser | Enter the code the gadget shows; `202` while the request waits for an admin. |
| `GET /api/claims` | browser | The account's requests still waiting. |
| `PATCH/DELETE /api/admin/devices/:id` | admin | Act on any account's gadget. |
| `PATCH /api/admin/users/:id/role` | admin | Grant or take away the admin role. |
| `POST /api/admin/claims/:id` | admin | Approve or refuse a claim request. |
| `POST /api/bridge/resolve` | bridge | Ownership, the agent (language, voice, providers and conversion), secret, partner, and recorded turns — or a claim code. |
| `POST /api/bridge/activate` | bridge | `200` when claimed, `202` while pending, `404` if unknown. |
| `POST /api/bridge/turns` | bridge | Record one served turn. |
| `POST /api/bridge/tools` | bridge | Record the tool catalogue a gadget declared. |
| `POST /api/bridge/hardware` | bridge | Record what the firmware reported about its own board at OTA. |
| `GET /firmware/:id` | gadget | A stored firmware image, with its byte length. No session; the identifier is opaque. |
| `GET /health` | anyone | Readiness: 200 only when the database answers. |

## Claiming a gadget

1. The gadget asks the bridge's OTA endpoint. Unknown to this service, it is given
   an `activation` code along with the socket address.
2. The gadget shows the code and speaks its digits.
3. The owner signs in here and enters it. That is a **request**, not ownership:
   the device waits for an admin to approve it (the gadget's page shows it under
   "đang chờ duyệt").
4. The gadget's `POST /activate` answers `202` while it waits; an admin approves
   at `/admin/claims`, and the device changes hands.
5. The gadget's next `POST /activate` answers `200`, and it connects.

The code is short-lived, single-use, and rate-limited per identifier. It narrows
the window in which someone who knows a `Device-Id` could claim the gadget first;
it does not close it, because the identifier is the gadget's own claim about
itself.

## What a gadget can do

The bridge reads the gadget's tool catalogue (`tools/list`) when a session opens
and reports it here; the device page lists the names and the firmware's own
descriptions. An empty catalogue is recorded as empty, which is a different fact
from a gadget that has not connected since the console was deployed. The console
never uses the catalogue to allow or refuse a call.

## The board a gadget runs on

The firmware posts a system-info body with every OTA request: the board type and
name, the chip, flash and PSRAM, the display, and the application version. The
bridge reads it and forwards a narrowed report; the console keeps that report on
the device row and shows it on the device page, with the time it arrived.

What is kept is what the device said. A field the firmware did not send is not
shown rather than filled from a board-type table, and a report outside the
console's bounds is refused whole, so the previous one stands. Identifiers —
MAC, UUID, IMEI, ICCID, IP — the partition table and the ELF hash are dropped at
the bridge and refused again at the console; no page carries them. A device that
has never reported says so, which is a different fact from a board that declared
no display.

## Firmware updates

Firmware is delivered through the OTA path the gadget already has. An admin
uploads an image for its board type with the version the image reports, and marks
it as that board type's target. At its next OTA — a boot — an owned device whose
reported version differs from the target is told to install it; the gadget
downloads the image from this console, writes the inactive slot, and reboots. The
new version comes back in the board report.

What the console does **not** do:

- It does not order versions. A device is offered a target only when the version
  it reported differs from the target's; whether the target is newer is the
  firmware's decision. An admin may mark a release forced, which allows a
  downgrade, and that mark is written to the audit line.
- It does not offer an update to an unowned device, to a device that has never
  reported its board, or to one already running the target — the last is what
  keeps a forced target from reflashing the same image on every boot.
- It never accepts a firmware URL from a request. The URL is built from
  `CONSOLE_PUBLIC_URL`, and with that unset no release is delivered at all.
- It does not read or write flash at an arbitrary address, and it does not sign
  images. Images are served unauthenticated at an opaque URL; a targeted release
  cannot be deleted until the target is cleared or moved.

`FIRMWARE_DIR` must be outside the application's `public` directory — the console
refuses the web root and any path under it, rather than letting the static handler
serve an image beside this route. New directories and images are created owner-only
where the platform carries POSIX modes; on Windows those modes are advisory, so the
directory's ACL is the deployment's responsibility. Serving uses `lstat` and accepts
only a regular file, so a symbolic link or a directory at a release's path is
refused.

## Tests

`npm test` runs against `TEST_DATABASE_URL`, truncating between cases. The suite
covers registration and sign-in, ownership scoping, agent validation, claiming
(including two accounts racing for one code, approval, refusal and expiry), provider
profiles and their encryption, the provider seed,
the bridge contract (resolution, activation, turns, tool catalogues), the admin
area and its role rules, the guide's two languages, and retention.

## Notes

- Passwords are hashed with `node:crypto` scrypt; sessions are stored as hashes.
- No browser response carries a device secret, a runtime credential, or an LLM
  key. A profile's key is encrypted at rest (`LLM_KEY_SECRET`), read back only by
  the bridge's resolve route, and a browser is told only that one is set.
- The voice is the profile's unless the agent names one; an owner picks from the
  deployment's voices, and the agent's Advanced form and the profile settings are
  administrator surfaces.
- The admin area's own strings are kept out of the shared dictionary, so an
  ordinary account's page never carries them.

## The calibration API

The console holds each device's speech-gate pair and the deployment default; the bridge is told the
effective pair when it resolves a gadget, so every bridge replica starts a connection from the same
value.

| Route | Who | What |
| --- | --- | --- |
| `GET/PUT/DELETE /api/devices/:id/calibration` | administrator | A device's pair; DELETE returns it to the default |
| `GET/PUT /api/calibration/default` | administrator | The deployment default |
| `PUT /api/bridge/calibration` | the bridge's token | A device's own session saving the pair it measured |

Writes validate the threshold strictly between 0 and 1 and the frame count at least 1, and each
change leaves an audit row naming the actor — an operator account or the device's session — and the
pair that was in effect before.
