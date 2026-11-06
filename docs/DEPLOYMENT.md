# Deployment

Day-to-day operation — deploying an update, changing a secret, reading the logs, fixing a turn —
lives in `RUNBOOK.md`. Rebuilding it from nothing is `PROVISIONING.md`. This file is what the
deployment is.

The pilot deployment planned by `gadget-console-gcp-console-bridge-deployment`. One Compute Engine
app host runs the console, the bridge and the runtime; one GPU host runs the speech tier —
speech-to-text, the TTS gateway and engines, and voice conversion; the console's database is
Cloud SQL.
The deployment publishes built-in `stt`, `tts` and `llm` providers, so an owner picks a personality
and never configures a provider.

## What runs where

| Component | Runs on | Listens | Reached from |
| --- | --- | --- | --- |
| Caddy | `gadget-app` | `:80`, `:443` | the internet |
| console (`gadget-console`) | `gadget-app` | `:3001` | Caddy, over loopback |
| runtime (`adaptive-interview-api`) | `gadget-app` | `127.0.0.1:4000` | the bridge, over loopback |
| bridge (`gadget-bridge`) | `gadget-app` | `:8003` OTA, `:8001` WS | Caddy only; no firewall rule opens them |
| STT proxy and `audiocpp` (CUDA) | `gadget-gpu` | `gadget-gpu:8080` | the app host, over the private subnet |
| audio gateway (`interview-audio/gateway`) | `gadget-gpu` | `gadget-gpu:8082` | the app host, over the private subnet |
| TTS engines (`kokoro`, `piper`, `supertonic`) | `gadget-gpu` | inside the compose network | the gateway, over the compose network |
| voice conversion (`interview-ovc`) | `gadget-gpu` | `gadget-gpu:8085` | the app host, over the private subnet |
| Cloud SQL Postgres | managed | `<db-private-ip>:5432` | the host's subnet |

Only 80 and 443 are opened to the internet. Caddy terminates TLS for both hostnames and proxies
`gw.<domain>/xiaozhi/ota*` to 8003 and `gw.<domain>/xiaozhi/v1*` to 8001, so a gadget speaks
`https` and `wss`. The bridge's raw ports, the console's internal API and the runtime have no
firewall rule at all, and the runtime's socket is bound to loopback as well. The GPU host is
reached only from the app host's tag; its services have no authentication of their own, so the
private subnet is the boundary.

`gadget-gpu` is one `g2-standard-4` (4 vCPU, 16 GB, one NVIDIA L4 with 24 GB) in
`asia-southeast1-b`, tag `gpu`, a 100 GB boot disk, no service account and no external address.
It runs `audiocpp` with the CUDA backend, the STT proxy, the TTS gateway and engines, and
OpenVoiceChanger with its GPU override. The L4 leaves room for both models — roughly 3 GB for
speech-to-text and under 1 GB for conversion — so the two run together; a 4 GB card could not do
both reliably. Measured on this host: transcription at about 6.9× realtime, conversion of a 4 s
segment in about 0.4 s.

The runtime carries `OVC_URL=http://gadget-gpu:8085`, `OVC_MODEL=vctk-p225.pth`,
`OVC_TIMEOUT_MS=60000`, `OVC_REQUIRED=false` and the deployment shaping. A systemd unit,
`gadget-ovc-activate`, activates the model after the container answers and verifies
`"active":true`, so a restart does not leave the service silently delivering unconverted audio.
Agents choose inherit, no voice changer, or their own shaping; the runtime's `/health` names the
service's reachability and active model. `OVC_REQUIRED=false` means a failed conversion delivers
the unconverted audio and reports it rather than failing the turn.

## Host

- `gadget-app`, zone `asia-southeast1-a`, machine type `e2-medium`, Ubuntu 22.04, network tag
  `app`, service account `gadget-vm@<project>.iam.gserviceaccount.com` with the `cloud-platform`
  scope (needed to read Secret Manager).
- 20 GB boot disk, plus a 20 GB `pd-balanced` data disk mounted at `/var/lib/firmware`.
- Static address `gadget-app-ip`. DNS: `console.<domain>` and `gw.<domain>`, both **DNS
  only** in Cloudflare — a proxied `gw` breaks the WebSocket the bridge advertises.

`gadget-gpu` is the speech host: zone `asia-southeast1-b`, machine type `g2-standard-4` with the
L4, Ubuntu 22.04, network tag `gpu`, no service account, and a 100 GB boot disk. It has no
external address; a temporary one was used to build it and removed. The trees are
`/srv/audio-tier` (the compose project and its models at `/srv/audio-models`) and `/srv/ovc` (the
conversion compose project, with models at `/srv/ovc-models` and the activation unit). Both model
directories are re-provisionable and are not backed up. The host was built from snapshots of the
two former CPU hosts it replaces; those hosts and their disks are deleted.

## Ports

| Port | Source | Purpose |
| --- | --- | --- |
| 80 | `0.0.0.0/0` | ACME challenge and the redirect to HTTPS |
| 443 | `0.0.0.0/0` | the console, and `gw` for OTA and the socket |
| 22 | `35.235.240.0/20` | SSH through IAP only |
| 8080 | the `app` tag (private subnet) | the GPU host's STT proxy |
| 8082 | the `app` tag (private subnet) | the GPU host's TTS gateway |
| 8085 | the `app` tag (private subnet) | the GPU host's voice conversion |

Everything else is denied by the implied ingress rule, including the bridge's 8001 and 8003. The
GPU host's SSH is closed to the internet by a higher-priority deny; only IAP reaches it.

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

The deployment's built-in providers live in the console's database, not in a service file: the
STT and TTS endpoints and the LLM key, the key encrypted with `LLM_KEY_SECRET`. They are published
by `npm run seed:providers` with `PROVIDER_SEED`, and changed only by re-running it. No browser
route creates, edits or deletes a built-in.

| Service | Environment |
| --- | --- |
| console | `NODE_ENV`, `DATABASE_URL`, `BRIDGE_TOKEN`, `LLM_KEY_SECRET`, `FIRMWARE_DIR=/var/lib/firmware`, `CONSOLE_PUBLIC_URL` |
| runtime | `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=4000`, `API_AUTH_TOKEN`, `VOICE_AGENT_MAX_HISTORY=8`, `OVC_URL`, `OVC_MODEL`, `OVC_TIMEOUT_MS`, `OVC_REQUIRED`, `VOICE_AGENT_OVC_PITCH_SHIFT`, `VOICE_AGENT_OVC_FORMANT_SHIFT`, `VOICE_AGENT_OVC_F0_METHOD` |
| bridge | `BRIDGE_CONSOLE_URL=http://127.0.0.1:3001`, `BRIDGE_CONSOLE_TOKEN`, `BRIDGE_PUBLIC_HOST=gw.<domain>`, `BRIDGE_PUBLIC_URL=https://gw.<domain>`, `BRIDGE_VAD_MIN_RMS=2500`, `BRIDGE_VAD_FLOOR_RATIO=2.0`, `BRIDGE_HISTORY_TURNS=8`, `BRIDGE_MUSIC_DIR=/srv/music`, `BRIDGE_MUSIC_GAIN_DB=-3`, `BRIDGE_SPEECH_PROB_MIN=0.5`, `BRIDGE_SPEECH_MIN_FRAMES=3`; `OTA_PORT` and `WS_PORT` keep their defaults (8003 and 8001) |

The runtime is given no `DATABASE_URL`, no `OLLAMA_*`, no `AUDIOCPP_BASE_URL`, no
`AUDIO_GATEWAY_URL` and no `PROVIDER_CATALOG`. Its speech providers come from the agent's
built-in profiles (or, for an administrator's agent, the account's own). Its interview routes
therefore answer 500; this deployment serves the gadget path only.

## The values that must agree

- the console's `BRIDGE_TOKEN` **equals** the bridge's `BRIDGE_CONSOLE_TOKEN`;
- the token stored in the `runtimes` row **equals** the runtime's `API_AUTH_TOKEN`;
- `RUNTIME_URL` in that row is `http://127.0.0.1:4000`;
- `BRIDGE_PUBLIC_HOST` is `gw.<domain>`, `BRIDGE_PUBLIC_URL` is `https://gw.<domain>` — the
  front the bridge advertises — and `CONSOLE_PUBLIC_URL` is `https://console.<domain>`;
- the built-in `stt` endpoint is `http://gadget-gpu:8080` and the built-in `tts` endpoint is
  `http://gadget-gpu:8082`; the runtime's `OVC_URL` is `http://gadget-gpu:8085`.

A mismatch answers 401 — at the console for the bridge, at the runtime for the bridge — rather than
failing quietly. A speech endpoint that no longer answers fails the turn at that stage and names it.

## State

- The console's records live in Cloud SQL `gadget-db` (Postgres 16, Enterprise, `db-f1-micro`,
  private IP), database `gadget_console`, user `console`.
- Firmware images and uploads live on the app host's data disk at `/var/lib/firmware`.
- Speech models live on the GPU host at `/srv/audio-models` and `/srv/ovc-models`; both are
  re-provisionable and are not backed up.

### Backups

Cloud SQL keeps automated backups, and the data disk is snapshotted on a schedule; neither is
required to start a session, and both are what makes a lost host or a dropped table recoverable.
The database is restored into a scratch instance to prove the backup, and the disk's snapshot is
what a replacement host mounts.

## First run

1. Create an account at `https://console.<domain>`, then grant it the admin role:
   `npm run role -- <email> admin` from `/srv/gadget-console`.
2. Seed the runtime and the deployment's built-ins from `/srv/gadget-console`:

   ```bash
   RUNTIME_TOKEN="$(the runtime token)" npm run seed:runtime
   PROVIDER_SEED='[
     {"kind":"llm","name":"<model name>","baseUrl":"<openai-compatible url>","model":"<model>","apiKey":"<key>","default":true},
     {"kind":"stt","name":"Speech to text","baseUrl":"http://gadget-gpu:8080","model":"stt","default":true},
     {"kind":"tts","name":"Voice","baseUrl":"http://gadget-gpu:8082","model":"piper","voice":"<voice>","default":true}
   ]' npm run seed:providers
   ```

3. Claim a gadget through the activation code its OTA answer carries; an admin approves it at
   `/admin/claims`.
4. As the owner, open the home, choose a personality: choose the language and the voice
   (defaults: piper; bryce in English, vi_VN-vais1000-medium in Vietnamese), use "Hear it", and
   save.
5. Speak to the gadget. The turn reaches the runtime over loopback, the built-in providers answer,
   and the record names them.

If the deployment publishes no built-in of a kind, the owner's form says the deployment has no
model or voice, and a turn that needs one fails with a message naming what is missing rather than
calling an endpoint nobody chose.

## Start and stop

The app host and the GPU host are started for a session and stopped afterwards; the disks persist.

```bash
npm run ops -- session start   # Cloud SQL, app host, GPU host; every health endpoint
npm run ops -- session stop    # app host, then GPU host, then Cloud SQL
npm run ops -- status          # every state, unit, revision and the speech endpoints
```

Both the `audio` and `ovc` entries in `ops.local.json` name `gadget-gpu`; the tool tolerates the
second start or stop of the same instance. `start` waits for the app host's services, then the GPU
host's gateway and the conversion model; it names the dependency that did not arrive. `stop`
refuses while a gadget is connected to the bridge or a turn is recent; `--force` stops anyway. It
waits for the database to reach `STOPPED` before reporting. Stopping deletes nothing; the OVC model
is restored by its activation unit on the next start. The reserved address still bills while the
host is stopped (about $7 a month) until it is released.

## Cost

List price in `asia-southeast1`, checked on 2026-11-06:

- about **$50–60 a month** with the app host and database running continuously;
- about **$635 a month** for the GPU host running continuously (`g2-standard-4`, one L4 at about
  $0.87/hour), or about **$1.74 per two-hour session**; its 100 GB disk is about **$10 a month**
  whether it runs or is stopped;
- about **$30–40 a month** idle: the database's storage, the disks and the reserved address while
  it is unattached;
- two boot snapshots of the retired CPU hosts are kept for rollback and cost a few dollars a
  month.

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
- **The tree must be committed.** The packaging step refuses uncommitted changes, because a
  package holds only `HEAD`.

The database migration is explicit: `npm run ops -- deploy console --migrate`. `--rollback` returns
to the previous release; it does not reverse a migration.

The speech tier is not deployed by `ops`. It is updated on `gadget-gpu`: the audio compose project
in `/srv/audio-tier` and the conversion project in `/srv/ovc`, where the OVC image is built with
`docker-compose.ovc.gpu.yml`.

## Known gaps

- **Built-ins are seed-only.** There is no admin editor for the deployment's built-in providers:
  the seed command is the only way to add or change one, and every browser create/edit/delete of a
  built-in answers not-found. An operator without the seed environment cannot fix a wrong voice
  from the console.
- **The `ops` speech probes are operator-side.** `speech.sttUrl` and `speech.ttsUrl` are fetched from
  the operator's machine, but the speech tier is private; the authoritative readiness check is the
  SSH wait on `gadget-gpu`. The STT probe can report unreachable while the tier is healthy.
- **One GPU host carries the whole speech tier.** Its L4 is ample for the pilot (STT and
  conversion together use about 4 GB), but it is one instance of each service: a host or card
  failure takes transcription, synthesis and conversion together.
- **No model and no knowledge retrieval.** `material` answer mode has nothing to speak, and the
  document-extraction service is not deployed.
- Caddy carries the WebSocket upgrade; a wrong path match breaks every gadget at once, so the
  check after a config change is a `wss` handshake from outside.
- A gadget must be flashed with the OTA address `https://gw.<domain>/xiaozhi/ota/`; one that
  cannot be reflashed keeps the raw `http` answer and falls outside this deployment.
- One instance of the runtime only: it holds prefetch and tool-call state in memory.
