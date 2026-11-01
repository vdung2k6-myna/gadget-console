# Runbook

How to deploy, update and repair the pilot described in `DEPLOYMENT.md`. That file says what the
deployment is; this one is the day-to-day. To build it from nothing, `PROVISIONING.md` has the
commands and the three files verbatim.

## Where everything is

| What | Where |
| --- | --- |
| Host | `gadget-app`, zone `asia-southeast1-a`, `e2-medium`, Ubuntu 22.04 |
| Console tree | `/srv/gadget-console/current` (Next.js) |
| Runtime tree | `/srv/adaptive-interview-api/current` (Express) |
| Bridge tree | `/srv/gadget-bridge/current` |
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

`start` brings Cloud SQL to `RUNNABLE`, then starts the host and waits for every unit and health
endpoint before reporting the session ready. `stop` refuses while a gadget is connected to the
bridge or a turn was recorded within the guard window (`guardMinutes`, 15 by default), then stops
the host and the database; `--force` stops anyway. `status` reports both states, every unit, every
deployed revision and any drift, without changing anything.

Stopping bills no compute and no database instance; disks, database storage and the reserved address
remain (about $20–25 a month). The services come back on their own. The budget alert is 1,500,000 ₫
(about $60) at 50, 90 and 100 percent.

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

The console's `stt` and `tts` profiles point at services that run on the developer's machine, not
on the host:

| Kind | URL | Runs on | Reaches |
| --- | --- | --- | --- |
| `stt` | `https://stt.<domain>` | the developer's machine, Docker (`stt-proxy` → `audiocpp`) | `127.0.0.1:8080` |
| `tts` | `https://tts.<domain>` | the same machine (`gateway` → three engines) | `127.0.0.1:8082` |

Both hostnames are a **named Cloudflare tunnel** (`gadget-audio`), not a quick tunnel: the URL is
stable across restarts, and the tunnel runs as the Windows service `cloudflared-gadget-audio`
(Automatic, LocalSystem), so it starts at boot without a sign-in and the service manager restarts it
if it exits. Its config and credentials live in `C:\ProgramData\cloudflared-gadget-audio\` so the
service account can read them. The DNS records are proxied, which is correct for HTTP — unlike `gw`,
which must stay grey.

The audio stack is this repository's `docker-compose.audio.yml`; `docker compose ps` on that machine
shows the five containers, and the two ports are published on loopback only. When a turn fails at a
speech call:

1. `docker compose ps` — the containers are up and healthy;
2. `curl -s https://stt.<domain>/health` and `https://tts.<domain>/health` — the tunnel reaches them;
3. `Get-Service cloudflared-gadget-audio` — `Running`, and `cloudflared tunnel info gadget-audio`
   lists a connector.

A machine that is off or asleep is an audio tier that is down: the profiles stay valid, and every
turn fails at its first speech call.

## Troubleshooting

| Symptom | First check |
| --- | --- |
| Bridge logs `the console did not take … (401)` | `BRIDGE_TOKEN` vs `BRIDGE_CONSOLE_TOKEN` |
| Turn rejected `no transcription provider is configured` | the agent's `stt` profile is unset or unreachable |
| Turn rejected `fetch failed` | the agent's `llm` profile, or the runtime's own model address has nothing behind it |
| Turn rejected `STT failed (404)` | the profile's base URL already ends in `/v1`; the runtime appends `/v1/audio/…` itself |
| Device page lists no tools | the bridge's warning carries the console's reason; see `TOOL_LIMITS` in `src/lib/device-tools.ts` |
| `wss` handshake fails from outside | the `gw` block in the Caddyfile, then `journalctl -u caddy` |
| Certificate warning on `console` | `journalctl -u caddy`; Caddy renews automatically |
| Device connects, no turn ever | the endpointer line: `floor` and `peak` say whether the gate was ever crossed |

The profiles live in the console, not on the host: a change there is made at
`https://console.<domain>/provider-profiles`, not in an environment file.

## What not to do

- Do not edit files under `/srv/…` on the host: the next release replaces `current`, and pruning
  removes old releases.
- Do not edit `/etc/gadget/*.env`: they are rewritten at boot.
- Do not open 8001 or 8003 in a firewall rule; the front exists so they stay closed.
- Do not commit a secret, a real device identifier or an environment file.
- Do not point a profile at a quick tunnel for anything longer than a test: the URL changes when the
  tunnel restarts. The pilot's providers use the named tunnel above for that reason.
