# Deployment

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
| Cloud SQL Postgres | managed | `<db-private-ip>:5432` | the host's subnet |

Only 80 and 443 are opened to the internet. Caddy terminates TLS for both hostnames and proxies
`gw.<domain>/xiaozhi/ota*` to 8003 and `gw.<domain>/xiaozhi/v1*` to 8001, so a gadget speaks
`https` and `wss`. The bridge's raw ports, the console's internal API and the runtime have no
firewall rule at all, and the runtime's socket is bound to loopback as well.

## Host

- `gadget-app`, zone `asia-southeast1-a`, machine type `e2-medium`, Ubuntu 22.04, network tag
  `app`, service account `gadget-vm@<project>.iam.gserviceaccount.com` with the `cloud-platform`
  scope (needed to read Secret Manager).
- 20 GB boot disk, plus a 20 GB `pd-balanced` data disk mounted at `/var/lib/firmware`.
- Static address `gadget-app-ip`. DNS: `console.<domain>` and `gw.<domain>`, both **DNS
  only** in Cloudflare — a proxied `gw` breaks the WebSocket the bridge advertises.

## Ports

| Port | Source | Purpose |
| --- | --- | --- |
| 80 | `0.0.0.0/0` | ACME challenge and the redirect to HTTPS |
| 443 | `0.0.0.0/0` | the console, and `gw` for OTA and the socket |
| 22 | `35.235.240.0/20` | SSH through IAP only |

Everything else is denied by the implied ingress rule, including the bridge's 8001 and 8003.

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
| runtime | `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=4000`, `API_AUTH_TOKEN` |
| bridge | `BRIDGE_CONSOLE_URL=http://127.0.0.1:3001`, `BRIDGE_CONSOLE_TOKEN`, `BRIDGE_PUBLIC_HOST=gw.<domain>`, `BRIDGE_PUBLIC_URL=https://gw.<domain>`; `OTA_PORT` and `WS_PORT` keep their defaults (8003 and 8001) |

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

The host is started for a session and stopped afterwards; the disks persist.

```bash
# start
gcloud sql instances patch gadget-db --activation-policy=ALWAYS    # if the instance was stopped
gcloud compute instances start gadget-app --zone=asia-southeast1-a
# wait for the three units, which start themselves
curl -s localhost:3001/health; curl -s localhost:4000/health
curl -s http://127.0.0.1:8003/

# stop
gcloud compute instances stop gadget-app --zone=asia-southeast1-a
gcloud sql instances patch gadget-db --activation-policy=NEVER     # optional
```

Stopping deletes nothing. An unattached static IP costs about $7 a month, which is why the address
is kept only while the deployment is in use.

## Cost

List price in `asia-southeast1`, checked on 2026-10-30:

- about **$50–60 a month** with the host and database running continuously;
- about **$20–25 a month** idle: the disks, the database's storage, and the reserved address while
  it is unattached;
- about **$0.10 for a two-hour session** of the host and database.

The billing account is denominated in VND and carries a 1,500,000 ₫ budget (about $60) with alerts
at 50, 90 and 100 percent, so a month that runs continuously is visible before it doubles.

## Updating a service

Each service is a tree under `/srv`, deployed from a tarball of the repository's HEAD:

```bash
cd /srv/gadget-console && sudo systemctl stop gadget-console
tar xzf /tmp/console.tar.gz -C /srv/gadget-console
npm ci && npm run build && sudo systemctl start gadget-console
```

The database migration is a separate, explicit step: `npm run db:migrate` from `/srv/gadget-console`
after a release that changes the schema.

## Known gaps

- No audio tier, no model and no knowledge retrieval: `material` answer mode has nothing to speak,
  and the document-extraction service is not deployed.
- An agent with no `llm` profile fails its turn with a connection error rather than a message.
- Caddy carries the WebSocket upgrade; a wrong path match breaks every gadget at once, so the
  check after a config change is a `wss` handshake from outside.
- A gadget must be flashed with the OTA address `https://gw.<domain>/xiaozhi/ota/`; one that
  cannot be reflashed keeps the raw `http` answer and falls outside this deployment.
- One instance of the runtime only: it holds prefetch and tool-call state in memory.
