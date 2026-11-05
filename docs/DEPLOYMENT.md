# Deployment

Day-to-day operation — deploying an update, changing a secret, reading the logs, fixing a turn —
lives in `RUNBOOK.md`. Rebuilding it from nothing is `PROVISIONING.md`. This file is what the
deployment is.

The pilot deployment planned by `gadget-console-gcp-console-bridge-deployment`. One Compute Engine
host runs the console, the bridge and the runtime; the console's database is Cloud SQL. The
deployment names no speech or model provider — an account configures its own `stt`, `tts` and
`llm` profiles, and an agent uses empty topics.

## What runs where

| Component | Runs on | Listens | Reached from |
| --- | --- | --- | --- |
| Caddy | `gadget-app` | `:80`, `:443` | the internet |
| console (`gadget-console`) | `gadget-app` | `:3001` | Caddy, over loopback |
| runtime (`adaptive-interview-api`) | `gadget-app` | `127.0.0.1:4000` | the bridge, over loopback |
| bridge (`gadget-bridge`) | `gadget-app` | `:8003` OTA, `:8001` WS | Caddy only; no firewall rule opens them |
| audio gateway (`interview-audio/gateway`) | `gadget-audio` | `gadget-audio:8082` | the app host, over the private subnet |
| TTS engines (`kokoro`, `piper`, `supertonic`) | `gadget-audio` | inside the compose network | the gateway, over the compose network |
| STT proxy and `audiocpp` | the developer's machine | behind `stt.<domain>` (Cloudflare tunnel) | the runtime, over HTTPS |
| voice conversion (`interview-ovc`) | `gadget-ovc` | `gadget-ovc:8085` | the app host, over the private subnet |
| Cloud SQL Postgres | managed | `<db-private-ip>:5432` | the host's subnet |

Only 80 and 443 are opened to the internet. Caddy terminates TLS for both hostnames and proxies
`gw.<domain>/xiaozhi/ota*` to 8003 and `gw.<domain>/xiaozhi/v1*` to 8001, so a gadget speaks
`https` and `wss`. The bridge's raw ports, the console's internal API and the runtime have no
firewall rule at all, and the runtime's socket is bound to loopback as well. The audio host is
reached only from the app host's tag; its gateway has no authentication of its own, so the private
subnet is the boundary.

The OVC host is optional and **CPU-only** on this pilot: `gadget-ovc` runs the conversion service
with its model on a local disk, and is reached only from the app host's tag. The runtime carries
`OVC_URL=http://gadget-ovc:8085` and `OVC_MODEL=vctk-p225.pth`; a systemd unit,
`gadget-ovc-activate`, activates the model after the container answers and verifies
`"active":true`, so a restart does not leave the service silently delivering unconverted audio.
Agents choose inherit, no voice changer, or their own shaping; the runtime's `/health` names the
service's reachability and active model. Conversion on two vCPUs costs roughly 20 seconds for a
short segment, so `OVC_REQUIRED=false` is set on this pilot: a failed conversion delivers the
unconverted audio and reports it.

## Host

- `gadget-app`, zone `asia-southeast1-a`, machine type `e2-medium`, Ubuntu 22.04, network tag
  `app`, service account `gadget-vm@<project>.iam.gserviceaccount.com` with the `cloud-platform`
  scope (needed to read Secret Manager).
- 20 GB boot disk, plus a 20 GB `pd-balanced` data disk mounted at `/var/lib/firmware`.
- Static address `gadget-app-ip`. DNS: `console.<domain>` and `gw.<domain>`, both **DNS
  only** in Cloudflare — a proxied `gw` breaks the WebSocket the bridge advertises.

`gadget-audio` is a second host: zone `asia-southeast1-a`, machine type `e2-medium`, Ubuntu 22.04,
network tag `audio`, no service account, and a 30 GB boot disk. The audio tree is
`/srv/audio-tier` and the model sets are `/srv/audio-models` (kokoro, piper, supertonic); the
models are re-provisionable and are not backed up. It holds an ephemeral external address for
egress only; no inbound rule opens it, and the gateway is bound to its private address.

## Ports

| Port | Source | Purpose |
| --- | --- | --- |
| 80 | `0.0.0.0/0` | ACME challenge and the redirect to HTTPS |
| 443 | `0.0.0.0/0` | the console, and `gw` for OTA and the socket |
| 22 | `35.235.240.0/20` | SSH through IAP only |
| 8082 | the `app` tag (private subnet) | the audio host's TTS gateway |

Everything else is denied by the implied ingress rule, including the bridge's 8001 and 8003. The
audio host's SSH is closed to the internet by a higher-priority deny; only IAP reaches it.

## Configuration and secrets

Four secrets live in Secret Manager, and the VM service account holds `secretAccessor` on exactly
those four:

| Secret | Used as |
| --- | --- |
| `bridge-token` | console `BRIDGE_TOKEN`, bridge `BRIDGE_CONSOLE_TOKEN` |
| `runtime-token` | runtime `API_AUTH_TOKEN`, and the seeded runtime record |
| `console-llm-key-secret` | console `LLM_KEY_SECRET` (base64 of 32 random bytes) |
| `gadget-db-password` | the password in the console's `DATABASE_URL` |

`/usr/local/bin/gadget-secrets.sh`, run at boot by `gadget-secrets.service`, writes them to
`/etc/gadget/console.env`, `api.env` and `bridge.env` (mode 0600). The three service units read
those files; no secret is written anywhere else on the host.

| Service | Environment |
| --- | --- |
| console | `NODE_ENV`, `DATABASE_URL`, `BRIDGE_TOKEN`, `LLM_KEY_SECRET`, `FIRMWARE_DIR=/var/lib/firmware`, `CONSOLE_PUBLIC_URL` |
| runtime | `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=4000`, `API_AUTH_TOKEN`, `VOICE_AGENT_MAX_HISTORY=8` |
| bridge | `BRIDGE_CONSOLE_URL=http://127.0.0.1:3001`, `BRIDGE_CONSOLE_TOKEN`, `BRIDGE_PUBLIC_HOST=gw.<domain>`, `BRIDGE_PUBLIC_URL=https://gw.<domain>`, `BRIDGE_VAD_MIN_RMS=2500`, `BRIDGE_VAD_FLOOR_RATIO=2.0`, `BRIDGE_HISTORY_TURNS=8`, `BRIDGE_MUSIC_DIR=/srv/music`, `BRIDGE_MUSIC_GAIN_DB=-3`, `BRIDGE_SPEECH_PROB_MIN=0.5`, `BRIDGE_SPEECH_MIN_FRAMES=3`; `OTA_PORT` and `WS_PORT` keep their defaults (8003 and 8001) |

The runtime is given no `DATABASE_URL`, no `OLLAMA_*`, no `AUDIOCPP_BASE_URL`, no
`AUDIO_GATEWAY_URL` and no `PROVIDER_CATALOG`. Its interview routes therefore answer 500; this
deployment serves the gadget path only.

## The values that must agree

- the console's `BRIDGE_TOKEN` **equals** the bridge's `BRIDGE_CONSOLE_TOKEN`;
- the token stored in the `runtimes` row **equals** the runtime's `API_AUTH_TOKEN`;
- `RUNTIME_URL` in that row is `http://127.0.0.1:4000`;
- `BRIDGE_PUBLIC_HOST` is `gw.<domain>`, `BRIDGE_PUBLIC_URL` is `https://gw.<domain>` — the
  front the bridge advertises — and `CONSOLE_PUBLIC_URL` is `https://console.<domain>`.

A mismatch answers 401 — at the console for the bridge, at the runtime for the bridge — rather than
failing quietly.

## State

- The console's records live in Cloud SQL `gadget-db` (Postgres 16, Enterprise, `db-f1-micro`,
  private IP), database `gadget_console`, user `console`.
- Firmware images and uploads live on the data disk at `/var/lib/firmware`.
- Model files, audio services and the document-extraction service are **not** part of this
  deployment, so there is nothing else to provision.

### Backups

Cloud SQL keeps automated backups, and the data disk is snapshotted on a schedule; neither is
required to start a session, and both are what makes a lost host or a dropped table recoverable.
The database is restored into a scratch instance to prove the backup, and the disk's snapshot is
what a replacement host mounts.

## First run

1. Create an account at `https://console.<domain>`, then grant it the admin role:
   `npm run role -- <email> admin` from `/srv/gadget-console`.
2. Claim the gadget through the activation code its OTA answer carries.
3. Configure three provider profiles on `/provider-profiles` — `stt`, `tts` and `llm` — and bind
   them to an agent whose topics list is empty and whose answer mode is `generate`.
4. Speak to the gadget. The turn reaches the runtime over loopback and the record names the three
   profiles.

An account that has configured no profile cannot hold a conversation: the `stt` and `tts` failures
name the missing kind, while a missing `llm` profile surfaces as a connection error, because the
runtime's own model address is `localhost:11434` and nothing serves it. A keyless endpoint (a local
Ollama, LM Studio) is registered with a placeholder key the endpoint ignores.

## Start and stop

The app host and the audio host are started for a session and stopped afterwards; the disks persist.

```bash
npm run ops -- session start   # Cloud SQL, app host, audio host; every health endpoint
npm run ops -- session stop    # app host, then audio host, then Cloud SQL
npm run ops -- status          # every state, unit, revision and the audio gateway
```

`start` waits for the app host's services and, when the operator configuration names an audio host,
starts it and waits for the gateway; it names the dependency that did not arrive. `stop` refuses
while a gadget is connected to the bridge or a turn is recent; `--force` stops anyway. It waits
for the database to reach `STOPPED` before reporting, so the start that follows does not collide
with the stop's own operation. Stopping deletes nothing. The reserved address still bills while the
host is stopped (about $7 a month) until it is released; the tool reports it rather than releasing
it, because re-pointing DNS from a deploy is a worse failure than seven dollars.

## Cost

List price in `asia-southeast1`, checked on 2026-10-30:

- about **$50–60 a month** with the app host and database running continuously;
- about **$25–30 a month** more with the audio host running continuously;
- about **$34 a month** more with the CPU OVC host running continuously (`e2-medium` + 100 GB);
- about **$30–35 a month** idle now that the OVC disk is part of the deployment: the disks, the
  database's storage, and the reserved address while it is unattached;
- about **$0.20 for a two-hour session** of the app, audio and database, plus roughly **$0.07**
  for the OVC host's hours;
- the four Compute Engine hosts total **6 of the trial's 8 vCPUs** (app 2 + audio 2 + OVC 2).

The billing account is denominated in VND and carries a 1,500,000 ₫ budget (about $60) with alerts
at 50, 90 and 100 percent, so a month that runs continuously is visible before it doubles.

## Updating a service

Each service is a release under `/srv/<service>/releases/<commit>`, reached through
`/srv/<service>/current`. `npm run ops -- deploy <service>` packages a committed revision, ships it
over IAP, builds it, switches the symlink and verifies the result; `RUNBOOK.md` has the commands.
The rules it enforces:

- **The build's exit status is the check that it happened.** A failed build leaves the previous
  release serving; the unit is not restarted and the deploy exits non-zero. `/health` answering 200
  is not proof that the new release is serving.
- **Extract and build as the account the units run as.** The deploy runs as the operator over IAP,
  which must be `<deploy-user>`; `sudo` is kept for `systemctl` alone.
- **The revision is written into the package** as `REVISION`. A deploy that cannot show that revision
  answering, after the switch, exits non-zero.

The database migration is explicit: `npm run ops -- deploy console --migrate`. `--rollback` returns
to the previous release; it does not reverse a migration.

## Known gaps

- The audio host runs the TTS tier only. STT (`audiocpp`) stays on the developer's machine behind
  `stt.<domain>` and a Cloudflare tunnel, so a machine that is off or asleep is a speech tier that
  is down at its first call. No model and no knowledge retrieval: `material` answer mode has
  nothing to speak, and the document-extraction service is not deployed.
- An agent with no `llm` profile fails its turn with `fetch failed` — the runtime's own model
  address, which nothing serves — rather than a message naming what is missing; an agent with no
  `stt` profile is told `no transcription provider is configured for this turn`.
- Caddy carries the WebSocket upgrade; a wrong path match breaks every gadget at once, so the
  check after a config change is a `wss` handshake from outside.
- A gadget must be flashed with the OTA address `https://gw.<domain>/xiaozhi/ota/`; one that
  cannot be reflashed keeps the raw `http` answer and falls outside this deployment.
- One instance of the runtime only: it holds prefetch and tool-call state in memory.
