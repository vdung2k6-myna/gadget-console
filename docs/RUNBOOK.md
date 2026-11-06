# Runbook

How to deploy, update and repair the pilot described in `DEPLOYMENT.md`. That file says what the
deployment is; this one is the day-to-day. To build it from nothing, `PROVISIONING.md` has the
commands and the three files verbatim.

## Where everything is

| What | Where |
| --- | --- |
| Host | `gadget-app`, zone `asia-southeast1-a`, `e2-medium`, Ubuntu 22.04 |
| Speech host | `gadget-gpu`, zone `asia-southeast1-b`, `g2-standard-4` (one NVIDIA L4), Ubuntu 22.04, 100 GB, no external IP |
| Console tree | `/srv/gadget-console/current` (Next.js) |
| Runtime tree | `/srv/adaptive-interview-api/current` (Express) |
| Bridge tree | `/srv/gadget-bridge/current` |
| Speech tree | `/srv/audio-tier` (compose project); models `/srv/audio-models` |
| STT proxy | `gadget-gpu:8080` (the instance's internal DNS name), reached only from the app host |
| Audio gateway | `gadget-gpu:8082`, reached only from the app host |
| OVC tree | `/srv/ovc` (compose project); models `/srv/ovc-models`; unit `gadget-ovc-activate` |
| OVC service | `gadget-gpu:8085`, reached only from the app host |
| Environment files | `/etc/gadget/console.env`, `api.env`, `bridge.env` (0600, rewritten at boot) |
| Secrets fetched at boot | `/usr/local/bin/gadget-secrets.sh`, run by `gadget-secrets.service` |
| Caddy | `/etc/caddy/Caddyfile`, unit `caddy` |
| Firmware and uploads | `/var/lib/firmware` (the 20 GB data disk) |
| Database | Cloud SQL `gadget-db`, private IP, database `gadget_console`, user `console` |

Units: `gadget-secrets` (oneshot), `gadget-console`, `gadget-api`, `gadget-bridge`. Each app unit is
`Restart=always` and reads its environment file, so a reboot needs no manual step.

```
internet --443--> Caddy --+--> console 127.0.0.1:3001
                          +--> gw: /xiaozhi/ota* -> 127.0.0.1:8003
                                   /xiaozhi/v1*  -> 127.0.0.1:8001
bridge --> console 127.0.0.1:3001, runtime 127.0.0.1:4000
console --> Cloud SQL <db-private-ip>:5432
runtime --> gadget-gpu:8080 (STT), :8082 (TTS), :8085 (conversion)
```

## Deploying an update

The host has no repository and no GitHub credential. The operator's machine packages and ships a
committed revision over IAP, from the console checkout:

```bash
cp ops.example.json ops.local.json         # once; the deployment's own names, gitignored
npm run ops -- deploy console              # ship, build, switch, verify
npm run ops -- deploy console --migrate    # when the release changes the schema
npm run ops -- deploy console --rollback   # return to the release that served before
npm run ops -- deploy bridge
npm run ops -- deploy runtime
```

`deploy` refuses a working tree with uncommitted changes, packages only the committed revision with
a `REVISION` file, installs and builds in a new release directory, and switches `current` only after
the build exits zero. It then restarts the unit and verifies that the revision answering is the one
shipped, that the unit restarted after the switch, and that the unit's `WorkingDirectory` names
`current`. A failed build leaves the previous release serving and exits non-zero. `--rollback`
returns to the previous release; migrations are not reversed.

The tool exists because three ways of deploying the wrong thing were seen here:

- **The tarball is old.** The package is now built and shipped in one command and deleted afterwards,
  so no `console.tar.gz` survives to be deployed by mistake. The `REVISION` file names the commit.
- **The build failed and nobody noticed.** The build's exit status is the gate: no switch, no restart,
  no success. `/health` is not the check — the deploy refuses to claim success unless the shipped
  revision is what answers.
- **The log file is not writable.** There is no shared log file to become root-owned; the build's
  output is the command's output, and the tree belongs to `<deploy-user>`.

A deployment is still verified by **something the release changed** — a string on `/help`, a route, a
column — as the final check after the tool reports the revision.

Releases live under `/srv/<service>/releases/<commit>`, with `/srv/<service>/current` a symlink to the
one serving. The three most recent are kept.

## Configuration and secrets

Nothing is edited in `/etc/gadget/*.env`: the files are rewritten from Secret Manager at every boot.
To change a value, edit the `gadget-secrets.sh` heredoc that produces it, then:

```bash
sudo systemctl restart gadget-secrets
sudo systemctl restart gadget-console   # or gadget-api / gadget-bridge
```

To rotate a token, add a new secret version and restart the two ends that share it:

```bash
printf '%s' "$NEW_TOKEN" | gcloud secrets versions add bridge-token --data-file=-
sudo systemctl restart gadget-secrets
sudo systemctl restart gadget-console gadget-bridge
```

The pairings that must agree, and the 401 each produces when they do not:

| Values | If they differ |
| --- | --- |
| console `BRIDGE_TOKEN` = bridge `BRIDGE_CONSOLE_TOKEN` | the bridge is refused at the console |
| seeded runtime token = runtime `API_AUTH_TOKEN` | the bridge is refused at the runtime |
| `RUNTIME_URL` = `http://127.0.0.1:4000` | the bridge reaches nothing |
| `BRIDGE_PUBLIC_URL` = the front | gadgets are told a raw port and cannot connect over TLS |

## Database

Migrations run once per release, from the console tree, with the environment the console itself
uses — the tree has no `.env`, so `DATABASE_URL` comes from the boot files:

```bash
sudo systemctl stop gadget-console
sudo bash -c 'set -a; . /etc/gadget/console.env; set +a; cd /srv/gadget-console && npx drizzle-kit migrate'
sudo systemctl start gadget-console
```

Connect by hand with the environment the console itself uses:

```bash
sudo bash -c 'set -a; . /etc/gadget/console.env; set +a; psql "$DATABASE_URL"'
```

Backups are automatic (Cloud SQL, 02:00 UTC, seven retained) and the data disk is snapshotted daily
(`gadget-daily`, seven days). A restore drill: clone the instance, read from the clone, delete it.

```bash
gcloud sql instances clone gadget-db gadget-db-restore
# from the host: psql against the clone's private IP
gcloud sql instances delete gadget-db-restore
```

## Logs and health

```bash
sudo journalctl -u gadget-bridge -f
sudo journalctl -u gadget-console -n 100 --no-pager

# the speech host's gateway, transcriber and conversion service
gcloud compute ssh gadget-gpu --zone=asia-southeast1-b --tunnel-through-iap \
  --command='sudo docker compose -f /srv/audio-tier/docker-compose.audio.yml logs -f gateway'
gcloud compute ssh gadget-gpu --zone=asia-southeast1-b --tunnel-through-iap \
  --command='sudo docker logs --tail 50 -f interview-ovc-ovc-1'
gcloud compute ssh gadget-app --zone=asia-southeast1-a --tunnel-through-iap \
  --command='curl -s http://gadget-gpu:8085/api/models/active'
```

A healthy bridge session prints `device connected`, the client and server hellos, and then either
`turn from speech: …` (a turn the endpointer closed) or `no speech in 15s` (a window nobody spoke
into). A turn's whole path is visible: the endpointer line with its gate and floor, `platform
transcribed the turn as …`, the `tts` sentences, and `turn recorded`.

Health: `localhost:3001/health` (console, answers 503 when the database is unreachable),
`localhost:4000/health`, and `http://127.0.0.1:8003/` for the bridge's advertised addresses.

### Logs in Cloud Logging

The host runs the Ops Agent, which ships journald to `projects/<project>/logs/syslog`. Each unit
tags its own lines (`gadget-bridge[pid]: …`, `gadget-console[pid]: …`), so one service is one
filter:

- Logs Explorer: `resource.type="gce_instance" logName:"syslog" jsonPayload.message:"gadget-bridge"`
- One device: add the identifier to the same filter, `"44bd8df214e8"`.
- CLI: `gcloud logging read 'logName:"syslog" AND "gadget-bridge"' --freshness=1h --format="value(timestamp, jsonPayload.message)"`

The agent installs with `add-google-cloud-ops-agent-repo.sh --also-install`, but it writes nothing
until the VM's service account holds `roles/logging.logWriter` and `roles/monitoring.metricWriter`
— it starts and stays green without them, which reads as "there are no logs".

## Start and stop

```bash
npm run ops -- session start
npm run ops -- session stop
npm run ops -- status
```

`start` brings Cloud SQL to `RUNNABLE`, then starts the app host and waits for every unit and health
endpoint; when the operator configuration names the speech host, it starts that instance next and
waits for its gateway, then for `/api/models/active` to report the model active. Both the `audio`
and `ovc` entries in `ops.local.json` name `gadget-gpu`, and the tool tolerates the second start or
stop of the same instance. `stop` refuses while a gadget is connected to the bridge or a turn was
recorded within the guard window (`guardMinutes`, 15 by default), then stops the app host, the
speech host and the database, in that order; `--force` stops anyway. It waits for the database to
reach `STOPPED` before it reports. `status` reports every state, every unit, every deployed
revision, the speech endpoints, the OVC model and any drift, without changing anything.

Stopping bills no compute and no database instance; disks, database storage and the reserved address
remain (about $30–40 a month: the app, speech and firmware disks, the database's storage and the
reserved address). The services come back on their own; the OVC model is restored by its activation
unit. The budget alert is 1,500,000 ₫ (about $60) at 50, 90 and 100 percent.

`speech.sttUrl` and `speech.ttsUrl` in `ops.local.json` are probed from the operator's machine, not
from the app host. On this deployment the speech tier is private: the TTS probe is skipped when an
audio host is configured, and the STT probe may report unreachable even when the tier is healthy.
The authoritative readiness check is the SSH wait on `gadget-gpu` that precedes it.

## Voice conversion

The speech host runs the conversion service; the runtime carries `OVC_URL`, `OVC_MODEL` and the
deployment shaping in `/etc/gadget/api.env`. Agents choose inherit, no voice changer, or their own
shaping in the console; the runtime's `/health` reports the service and its active model.

The active model lives in the service's memory only. `gadget-ovc-activate.service` activates it
after the container answers and verifies `"active":true`; if `/api/models/active` reports
`{"active":false}`, restart that unit on `gadget-gpu` (or restart `gadget-api`, whose boot check
also activates it). On the L4, conversion takes about 0.4 s for a 4 s segment; STT holds about 3 GB
and conversion under 1 GB of the 24 GB card, so the two run together. `OVC_REQUIRED=false` on this
pilot delivers the unconverted audio and reports a failure instead of failing the turn.

The service is the second compose project on the speech host, started with the GPU override:

```bash
cd /srv/ovc && sudo env OVC_MODELS_DIR=/srv/ovc-models OVC_BIND_ADDR=0.0.0.0 OVC_PUBLISHED_PORT=8085 \
  OVC_TAG=cpu docker compose -f docker-compose.ovc.yml -f docker-compose.ovc.gpu.yml up -d
```

## Changing the public surface

`/etc/caddy/Caddyfile` carries both hostnames. Console changes are a `reverse_proxy 127.0.0.1:3001`;
the `gw` block proxies `/xiaozhi/ota*` to 8003 and `/xiaozhi/v1*` to 8001 — the WebSocket upgrade
goes through the second. After an edit:

```bash
sudo systemctl reload caddy
sudo journalctl -u caddy -n 30 --no-pager
```

DNS lives in Cloudflare. **`gw` must stay DNS-only** (grey cloud): a proxied record terminates the
raw WebSocket the bridge advertises. Firewall rules open 80 and 443 only; 8001 and 8003 are not
reachable from the internet.

## Speech providers

The deployment publishes three built-in profiles in the console's database. An owner's turns use
them, and the owner never configures a provider.

| Kind | Endpoint | Runs on | Reaches |
| --- | --- | --- | --- |
| `stt` | `http://gadget-gpu:8080` | `gadget-gpu` (`stt-proxy` → `audiocpp`, CUDA) | the instance's internal name |
| `tts` | `http://gadget-gpu:8082` | `gadget-gpu` (`gateway` → three engines) | the instance's internal name |
| `llm` | an OpenAI-compatible endpoint | the provider | the internet |

The built-ins are seeded, not edited in a browser. From `/srv/gadget-console` with the console's
environment:

```bash
PROVIDER_SEED='[
  {"kind":"llm","name":"<model name>","baseUrl":"<openai-compatible url>","model":"<model>","apiKey":"<key>","default":true},
  {"kind":"stt","name":"Speech to text","baseUrl":"http://gadget-gpu:8080","model":"stt","default":true},
  {"kind":"tts","name":"Voice","baseUrl":"http://gadget-gpu:8082","model":"piper","voice":"<voice>","default":true}
]' npm run seed:providers
```

The seed is idempotent by `(builtin, kind, name)`, never deletes a row, and an `llm` entry that
names no `apiKey` keeps the stored key. The provider page lists the built-ins read-only; a browser
create, edit or delete of one answers not-found. To change a voice or an endpoint, edit the seed
list and run it again. An administrator may also configure the admin account's own speech settings
on the provider page; an owner cannot.

The audio tier is this repository's `docker-compose.audio.yml`, run on `gadget-gpu` with the
gateway, the STT proxy, `audiocpp` and the three engines. The tree has no `.env`, so the
provisioning environment must be passed on every `up` — without it the services republish on
loopback and the app host loses them:

```bash
cd /srv/audio-tier && sudo env AUDIO_BIND_ADDR=<gpu-private-ip> \
  AUDIO_MODELS_DIR=/srv/audio-models \
  docker compose -f docker-compose.audio.yml up -d audiocpp stt-proxy gateway tts-proxy kokoro piper supertonic
```

`audiocpp` runs with `--backend cuda` and holds about 3 GB of the L4. `tts-proxy` fronts the
engines; add a replica with `--scale <engine>=N` and restart `tts-proxy` so Caddy resolves it.

When a turn fails at a speech call:

1. On the speech host, `sudo docker compose -f /srv/audio-tier/docker-compose.audio.yml ps` — the
   seven containers are up and healthy, and `curl -s http://<gpu-private-ip>:8080/health` and
   `:8082/health` answer;
2. From the app host, `curl -s http://gadget-gpu:8080/health` and `:8082/health` — the internal
   name and the firewall rule;
3. For conversion, `curl -s http://gadget-gpu:8085/api/models/active` and
   `systemctl status gadget-ovc-activate` on the speech host.

The speech host is part of the session: `npm run ops -- session start|stop` starts and stops it
(both the `audio` and `ovc` entries in `ops.local.json` name `gadget-gpu`). The developer's machine
is no longer part of this deployment, and no Cloudflare tunnel carries speech.

## Troubleshooting

| Symptom | First check |
| --- | --- |
| Bridge logs `the console did not take … (401)` | `BRIDGE_TOKEN` vs `BRIDGE_CONSOLE_TOKEN` |
| Turn rejected `no transcription provider is configured` | no `stt` built-in is published, or the agent names one the account cannot use; check the built-ins and `http://gadget-gpu:8080/health` |
| Turn rejected `fetch failed` | no `llm` built-in is published or reachable; re-seed the built-in (or, for an admin's agent, check the account's profile) |
| Turn rejected `STT failed (404)` | the provider's base URL already ends in `/v1`; the runtime appends `/v1/audio/…` itself |
| Turn converts to nothing / unchanged voice | `curl -s http://gadget-gpu:8085/api/models/active`; restart `gadget-ovc-activate` on `gadget-gpu` if `"active":false` |
| Device page lists no tools | the bridge's warning carries the console's reason; see `TOOL_LIMITS` in `src/lib/device-tools.ts` |
| `wss` handshake fails from outside | the `gw` block in the Caddyfile, then `journalctl -u caddy` |
| Certificate warning on `console` | `journalctl -u caddy`; Caddy renews automatically |
| Device connects, no turn ever | the endpointer line: `floor` and `peak` say whether the gate was ever crossed |

The built-ins live in the console's database, seeded by `seed:providers`; an owner cannot change
them and neither can a browser route. An administrator's own speech settings are edited at
`https://console.<domain>/provider-profiles`.

## What not to do

- Do not edit files under `/srv/…` on the host: the next release replaces `current`, and pruning
  removes old releases.
- Do not edit `/etc/gadget/*.env`: they are rewritten at boot.
- Do not edit a built-in provider row in the database by hand: edit `PROVIDER_SEED` and re-run
  `seed:providers`, so a later seed does not silently reverse the change.
- Do not open 8001 or 8003 in a firewall rule; the front exists so they stay closed.
- Do not commit a secret, a real device identifier or an environment file.
- Do not point a speech provider at a quick tunnel. The deployment's speech tier is on
  `gadget-gpu`; a tunnel is only ever a temporary test, because its URL changes when it restarts.
