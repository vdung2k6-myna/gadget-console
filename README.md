# gadget-console

The console for people who own XiaoZhi voice gadgets: accounts, devices, the
agents that answer them, claims, the record of what was said, and a guide for the
person holding the gadget.

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
| `npm run prune` | Delete what is past its time now: unowned devices, dead claims, old turns. |
| `npm run role -- <email> <user\|admin>` | Grant or take away the admin role. |

## Configuration

| Variable | Required | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | The database this service owns. |
| `BRIDGE_TOKEN` | yes | The credential the bridge presents on `/api/bridge/*`. |
| `LLM_KEY_SECRET` | yes | Encrypts every account's LLM key, 32 bytes base64. Losing it makes every saved profile undecryptable. |
| `SESSION_TTL_MS` | no | How long a browser session lives (30 days). |
| `CLAIM_TTL_MS` | no | How long a claim code is good for (10 minutes). |
| `CLAIM_APPROVAL_TTL_MS` | no | How long an entered request waits for an admin before it is abandoned (24 hours). |
| `RETENTION_DAYS` | no | How long a turn is kept (90 days). |
| `UNCLAIMED_DEVICE_TTL_MS` | no | How old a device row nobody owns must be before it may be removed (7 days). |
| `PRUNE_INTERVAL_MS` | no | How often the cleanup runs (6 hours). `0` turns the timer off. |
| `PRUNE_BATCH` | no | Rows one cleanup removes per kind (1 000), so a backlog drains over several passes. |
| `TEST_DATABASE_URL` | for tests | A separate database; the tests truncate it. |
| `RUNTIME_TOKEN` | for seeding | The credential `seed:runtime` stores, with `RUNTIME_NAME` (default `interview`), `RUNTIME_URL`, `RUNTIME_ENGINES`, `RUNTIME_LANGUAGES`. |

## The data

| Table | What it holds |
| --- | --- |
| `users`, `sessions` | Accounts (with their role), and the hash of each live session token. |
| `runtimes` | A base URL, a credential, and the engines and languages it names. |
| `agents` | Prompt, topics, answer mode, language, engine, runtime, and the LLM profile that answers it. |
| `llm_profiles` | An account's OpenAI-compatible endpoint: base URL, model, encrypted key, temperature. |
| `devices` | A gadget: its identifier, its own secret, its owner, its agent, its partner, and the tool catalogue its firmware reported. |
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
- **`owner@example.com` is a protected admin** (`PROTECTED_ADMINS` in
  `src/lib/users.ts`): neither the command nor the admin area can return it to a
  user. To change that, edit the constant.
- Every change an admin makes to another account's gadget, and every role change,
  writes one `[admin] …` line naming the admin, the target and what was done.

Admins do **not** see an account's LLM profiles or keys: those are the account's
own credentials, not a gadget.

## Screens

| Page | What it shows |
| --- | --- |
| `/` | Sign in, or create an account. Signed-in visitors are sent to their devices. |
| `/devices` | The account's gadgets, the six-digit claim input, and a warning for a gadget with no agent. |
| `/devices/[id]` | One gadget: identifier, agent, partner, last seen, what it can do; rename, bind, pair, release; and its conversation record. |
| `/agents` | The account's agents, and which devices each answers. |
| `/agents/new`, `/agents/[id]` | The agent form: prompt, runtime, language, engine, answer mode, topics, answering model. |
| `/llm-profiles` | The account's own OpenAI-compatible endpoints: base URL, model, key, temperature. |
| `/help` | The guide: every step from unboxing to release, and what each common failure means. |
| `/admin/devices`, `/admin/users`, `/admin/claims` | The admin area: every device, every account, and the requests waiting for a decision. Visible in the header only to an admin. |

A walk through it, in order:

1. Open `http://127.0.0.1:3001/` and create an account.
2. Power a gadget. Its OTA answer carries a code; it shows and speaks the six digits.
3. Enter the code on `/devices`. The gadget appears, with "chưa gán agent".
4. Create an agent on `/agents/new`: a name, a prompt, and the runtime it should be
   answered by. The languages and engines offered are that runtime's own; the
   answering model may stay the runtime's default.
5. Open the gadget, choose the agent, and save.
6. Speak to the gadget. The turn appears under "Hội thoại" on its page, and the
   tools the gadget declared appear under "Thiết bị này làm được".
7. Releasing the gadget on the same page deletes that record and makes the gadget
   claimable again through a new code.

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
| `GET/POST /api/agents`, `PATCH/DELETE /api/agents/:id` | browser | Agents. |
| `GET/POST /api/llm-profiles`, `PATCH/DELETE /api/llm-profiles/:id` | browser | An account's own models. The key is write-only. |
| `POST /api/claims` | browser | Enter the code the gadget shows; `202` while the request waits for an admin. |
| `GET /api/claims` | browser | The account's requests still waiting. |
| `PATCH/DELETE /api/admin/devices/:id` | admin | Act on any account's gadget. |
| `PATCH /api/admin/users/:id/role` | admin | Grant or take away the admin role. |
| `POST /api/admin/claims/:id` | admin | Approve or refuse a claim request. |
| `POST /api/bridge/resolve` | bridge | Ownership, agent, secret, partner, the agent's LLM profile, and recorded turns — or a claim code. |
| `POST /api/bridge/activate` | bridge | `200` when claimed, `202` while pending, `404` if unknown. |
| `POST /api/bridge/turns` | bridge | Record one served turn. |
| `POST /api/bridge/tools` | bridge | Record the tool catalogue a gadget declared. |
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

## Tests

`npm test` runs against `TEST_DATABASE_URL`, truncating between cases. The suite
covers registration and sign-in, ownership scoping, agent validation, claiming
(including two accounts racing for one code, approval, refusal and expiry), LLM
profiles and their encryption,
the bridge contract (resolution, activation, turns, tool catalogues), the admin
area and its role rules, the guide's two languages, and retention.

## Notes

- Passwords are hashed with `node:crypto` scrypt; sessions are stored as hashes.
- No browser response carries a device secret, a runtime credential, or an LLM
  key. A profile's key is encrypted at rest (`LLM_KEY_SECRET`), read back only by
  the bridge's resolve route, and a browser is told only that one is set.
- The voice is not configured here: a runtime resolves it from `(engine,
  language)`, so an agent chooses those two and nothing else.
- The admin area's own strings are kept out of the shared dictionary, so an
  ordinary account's page never carries them.
