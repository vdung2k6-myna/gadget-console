# Provisioning

Building the pilot from nothing: the network, the database, the app host, the speech tier on the
operator's machine, the four secrets, the systemd units and the two Caddy sites. `DEPLOYMENT.md`
says what the result is and `RUNBOOK.md` how to operate it; this file is the one that assumes none
of it exists.

Run it in a bash shell with `gcloud` authenticated (Cloud Shell is enough). Nothing here is
idempotent by design — a second run against existing resources fails loudly, which is the right
answer for a rebuild.

```bash
export PROJECT=<your-project-id>
export REGION=asia-southeast1
export ZONE=asia-southeast1-a
export DOMAIN=example.com          # the deployment chooses its own
export CONSOLE_HOST=console.$DOMAIN
export BRIDGE_HOST=gw.$DOMAIN
gcloud config set project "$PROJECT"
gcloud config set compute/region "$REGION"
gcloud config set compute/zone "$ZONE"
```

## 1. APIs

```bash
gcloud services enable \
  compute.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  servicenetworking.googleapis.com billingbudgets.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com logging.googleapis.com monitoring.googleapis.com
```

## 2. Network, address, DNS

```bash
gcloud compute networks create gadget-vpc --subnet-mode=custom
gcloud compute networks subnets create gadget-subnet \
  --network=gadget-vpc --region="$REGION" --range=<vpc-range>

gcloud compute firewall-rules create gadget-web \
  --network=gadget-vpc --direction=INGRESS --action=ALLOW \
  --rules=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags=app
gcloud compute firewall-rules create gadget-iap-ssh \
  --network=gadget-vpc --direction=INGRESS --action=ALLOW \
  --rules=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=app

gcloud compute addresses create gadget-app-ip --region="$REGION"
gcloud compute addresses describe gadget-app-ip --region="$REGION" --format="value(address)"
```

At the DNS provider add two `A` records to that address: `console` and `gw`. Both **DNS only**, not
proxied — a proxied `gw` terminates the raw WebSocket the bridge advertises. Nothing else is
published: 8001 and 8003 are never opened, because Caddy reaches them over loopback.

## 3. Service account

```bash
gcloud iam service-accounts create gadget-vm --display-name="Gadget pilot host"
SA="gadget-vm@$PROJECT.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
  --role=roles/logging.logWriter --quiet
gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
  --role=roles/monitoring.metricWriter --quiet
```

The secret access is granted per secret in step 4, so the account can read exactly those four.

## 4. Secrets

The database password is generated once and used twice — on the user and in the secret — so they
cannot drift. `-NoNewline` is not decoration: a trailing newline in a token becomes a 401 between
two services that both look configured.

```bash
DB_PASSWORD=$(openssl rand -hex 24)
BRIDGE_TOKEN=$(openssl rand -hex 32)
RUNTIME_TOKEN=$(openssl rand -hex 32)
# The console's key must be base64 of exactly 32 bytes; it refuses anything else at boot.
LLM_KEY=$(openssl rand -base64 32 | tr -d '\n')

printf '%s' "$BRIDGE_TOKEN"  | gcloud secrets create bridge-token           --data-file=-
printf '%s' "$RUNTIME_TOKEN" | gcloud secrets create runtime-token          --data-file=-
printf '%s' "$LLM_KEY"       | gcloud secrets create console-llm-key-secret --data-file=-
printf '%s' "$DB_PASSWORD"   | gcloud secrets create gadget-db-password     --data-file=-
# The tailnet auth key is generated in the Tailscale admin console, not here.
printf '%s' "<auth-key>"     | gcloud secrets create tailscale-auth-key     --data-file=-

for s in bridge-token runtime-token console-llm-key-secret gadget-db-password tailscale-auth-key; do
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor --quiet >/dev/null
done
```

## 5. Database

```bash
gcloud compute addresses create google-managed-services-gadget --global \
  --purpose=VPC_PEERING --prefix-length=16 --network=gadget-vpc
gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-gadget --network=gadget-vpc

# Enterprise is required for the shared-core tier; new projects default to Enterprise Plus.
gcloud sql instances create gadget-db --database-version=POSTGRES_16 --edition=ENTERPRISE \
  --tier=db-f1-micro --region="$REGION" --network=gadget-vpc --no-assign-ip

gcloud sql databases create gadget_console --instance=gadget-db
gcloud sql users create console --instance=gadget-db --password "$DB_PASSWORD"

gcloud sql instances patch gadget-db --backup-start-time=02:00 --retained-backups-count=7 \
  --enable-point-in-time-recovery --retained-transaction-log-days=7
gcloud sql backups create --instance=gadget-db
```

The instance is private-only: there is no public IP to firewall, and `psql` works from the host's
subnet alone.

## 6. Host

```bash
gcloud compute instances create gadget-app --zone="$ZONE" --machine-type=e2-medium \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB --boot-disk-type=pd-balanced --tags=app \
  --network=gadget-vpc --subnet=gadget-subnet --address=gadget-app-ip \
  --service-account="$SA" --scopes=https://www.googleapis.com/auth/cloud-platform

gcloud compute disks create gadget-data --zone="$ZONE" --size=20GB --type=pd-balanced
gcloud compute instances attach-disk gadget-app --disk=gadget-data --zone="$ZONE" \
  --device-name=gadget-data

gcloud compute resource-policies create snapshot-schedule gadget-daily --region="$REGION" \
  --max-retention-days=7 --start-time=02:00 --daily-schedule
gcloud compute disks add-resource-policies gadget-data --zone="$ZONE" \
  --resource-policies=gadget-daily

gcloud compute ssh gadget-app --zone="$ZONE" --tunnel-through-iap
```

Inside the host:

```bash
sudo mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard /dev/disk/by-id/google-gadget-data
sudo mkdir -p /var/lib/firmware
sudo mount -o discard,defaults /dev/disk/by-id/google-gadget-data /var/lib/firmware
echo "UUID=$(sudo blkid -s UUID -o value /dev/disk/by-id/google-gadget-data) /var/lib/firmware ext4 discard,defaults,nofail 0 2" | sudo tee -a /etc/fstab
sudo chown -R "$USER":"$USER" /var/lib/firmware

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql-client

sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
sudo bash add-google-cloud-ops-agent-repo.sh --also-install

# Tailscale: install, then join the tailnet and tag the node. Complete the login
# URL it prints. The tag must be owned in the ACL policy before this runs.
curl -fsSL https://tailscale.com/install.sh | sudo sh
sudo tailscale up --advertise-tags=tag:gadget-app --hostname=gadget-app --accept-dns
```

`--scopes=cloud-platform` is what lets the host read Secret Manager at boot; without it the service
account's permissions exist and nothing can use them.

## 7. Files

### `/usr/local/bin/gadget-secrets.sh`

Fill in the project id at the top. This one script produces every environment file.

```bash
sudo tee /usr/local/bin/gadget-secrets.sh >/dev/null <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
PROJECT=<your-project-id>
TOKEN=$(curl -sf -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
secret() {
  curl -sf -H "Authorization: Bearer $TOKEN" \
    "https://secretmanager.googleapis.com/v1/projects/$PROJECT/secrets/$1/versions/latest:access" \
    | python3 -c 'import sys,json,base64;print(base64.b64decode(json.load(sys.stdin)["payload"]["data"]).decode())'
}
install -d -m 700 /etc/gadget
DB=$(secret gadget-db-password)

cat > /etc/gadget/console.env <<ENV
NODE_ENV=production
DATABASE_URL=postgresql://console:${DB}@<PRIVATE_IP>:5432/gadget_console
BRIDGE_TOKEN=$(secret bridge-token)
LLM_KEY_SECRET=$(secret console-llm-key-secret)
FIRMWARE_DIR=/var/lib/firmware
CONSOLE_PUBLIC_URL=https://<console-host>
PLATFORM_HOST=<platform-host>
ENV

cat > /etc/gadget/api.env <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=4000
API_AUTH_TOKEN=$(secret runtime-token)
VOICE_AGENT_MAX_HISTORY=8
ENV

cat > /etc/gadget/bridge.env <<ENV
BRIDGE_CONSOLE_URL=http://127.0.0.1:3001
BRIDGE_CONSOLE_TOKEN=$(secret bridge-token)
BRIDGE_PUBLIC_HOST=<bridge-host>
BRIDGE_PUBLIC_URL=https://<bridge-host>
BRIDGE_VAD_MIN_RMS=2500
# Quiet speech on this board peaked at 4.8-5.4k against a 2.5x floor of ~5-6k, so
# the ratio is 2.0: the window closes, and the speech gate below drops the extra
# noise a lower gate lets through.
BRIDGE_VAD_FLOOR_RATIO=2.0
BRIDGE_HISTORY_TURNS=8
BRIDGE_MUSIC_DIR=/srv/music
BRIDGE_MUSIC_GAIN_DB=-3
# Measured on the pilot 2026-11-03: real speech scores 0.94-0.99 and clears dozens
# of 512-sample frames at 0.5, while the room's low-frequency rumble (a fan beside
# the board) tops out around 0.40 and clears none. The shipped defaults separate the
# two populations; a window needs three qualifying frames. See docs/DEPLOYMENT.md.
BRIDGE_SPEECH_PROB_MIN=0.5
BRIDGE_SPEECH_MIN_FRAMES=3
ENV

# Join the tailnet with the stored auth key; node state survives a reboot, and
# this re-joins after that state is lost.
if command -v tailscale >/dev/null 2>&1; then
  TS_KEY=$(secret tailscale-auth-key 2>/dev/null || true)
  if [ -n "${TS_KEY:-}" ]; then
    for i in 1 2 3 4 5; do
      tailscale up --authkey="$TS_KEY" --hostname=gadget-app --accept-dns >/dev/null 2>&1 && break
      sleep 2
    done || true
  fi
fi

chmod 600 /etc/gadget/*.env
SCRIPT
sudo chmod +x /usr/local/bin/gadget-secrets.sh
```

`BRIDGE_VAD_MIN_RMS=2500` is this deployment's measured value, not a default: the gadgets'
microphones peak around 5 000–8 000 RMS at normal speaking distance, below the bridge's shipped
7 500 gate, so phrases at that distance never reached 500 ms of counted speech. Below roughly
2 000 the room's own floor (`2.5 ×`) starts to decide the gate, and the device's own speaker can be
counted as speech; measure again before changing it.

`VOICE_AGENT_MAX_HISTORY=8` bounds the runtime's conversation context to eight exchanges. The
bridge carries only turns that were answered; eight keeps enough context for a follow-up while
keeping a completed request from much earlier out of reach of a repeated tool call.
`BRIDGE_HISTORY_TURNS=8` gives the bridge the same bound, so it does not carry more conversation
than the runtime shows the model.

`BRIDGE_MUSIC_DIR=/srv/music` enables the bridge's own music: the MP3s under that directory
(subdirectories included) are what a gadget can ask it to play. The directory is read per request,
so a track added later needs no restart, and an empty or missing directory means no music at all —
the spoken commands then fall through as ordinary utterances. Only MP3 is decoded;
`BRIDGE_MUSIC_GAIN_DB=-3` is the level offset applied to it. The directory must be readable by the
bridge's own user (`vdung` on this host).

`<PRIVATE_IP>` is `gcloud sql instances describe gadget-db --format="value(ipAddresses[0].ipAddress)"`.

### systemd

```bash
sudo tee /etc/systemd/system/gadget-secrets.service >/dev/null <<'EOF'
[Unit]
Description=Fetch gadget deployment secrets from Secret Manager
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/gadget-secrets.sh

[Install]
WantedBy=multi-user.target
EOF

for name in api console bridge; do
  case $name in
    api)     DESC="Gadget runtime (adaptive-interview-api)"; DIR=/srv/adaptive-interview-api/current ;;
    console) DESC="Gadget console";                          DIR=/srv/gadget-console/current ;;
    bridge)  DESC="Gadget bridge";                           DIR=/srv/gadget-bridge/current ;;
  esac
  sudo tee /etc/systemd/system/gadget-$name.service >/dev/null <<EOF
[Unit]
Description=$DESC
After=network-online.target gadget-secrets.service
Wants=network-online.target
Requires=gadget-secrets.service

[Service]
User=$USER
WorkingDirectory=$DIR
EnvironmentFile=/etc/gadget/$name.env
SyslogIdentifier=gadget-$name
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
done
```

`SyslogIdentifier` is what makes each service a filter in Cloud Logging: without it every line
journald receives is `npm[pid]` and the three services are indistinguishable.

### `/etc/caddy/Caddyfile`

The listener is `deploy/Caddyfile.example` in the console repository. It serves
the platform host and every registered tenant console and gateway host, issuing
certificates on demand only for hosts the console authorizes. Install it after
the console is deployed (the ask endpoint must answer):

```bash
sudo install -m 644 /srv/gadget-console/current/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Ports 80 and 443 must stay open. The first tenant host is registered through the
platform admin API after the console is running; `docs/DOMAINS.md` has the
registration, DNS and verification steps.

## 8. The service trees

There is no repository and no GitHub credential on the host. The first deploy uses the same
operator tool as every later one (`RUNBOOK.md`): it packages a committed revision on your machine,
ships it over IAP, builds it and verifies it on the host.

The units read their environment from `/etc/gadget/*.env`, which does not exist until
`gadget-secrets.service` has run. Start it first:

```bash
sudo systemctl daemon-reload
sudo systemctl enable gadget-secrets
sudo systemctl start gadget-secrets
sudo systemctl status gadget-secrets --no-pager
```

Then, in the gadget-console checkout on your machine:

```bash
cp ops.example.json ops.local.json     # the deployment's own names; gitignored
npm run ops -- deploy console --migrate
npm run ops -- deploy bridge
npm run ops -- deploy runtime
```

The tool creates `/srv/<service>/releases/<commit>`, points `current` at it, installs and builds
(where there is a build), restarts the unit and verifies that the shipped revision answers. The
units' `WorkingDirectory` must already name `current` (§7). It runs the file work as `<deploy-user>`,
never as root: a root-owned tree breaks the next build. The build's exit status is the check — a
failed build leaves the previous release answering `/health` while serving old content, and the
tool refuses to call that success.

### The speech tier (STT, TTS and conversion)

The speech tier runs on the operator's machine, reached over a private tailnet. It is not a
cloud instance: Docker with the NVIDIA container toolkit, the audio compose project, the
conversion compose project with its GPU override, and the Tailscale client. That machine's card is
the deployment's only GPU, and transcription and conversion share it.

Install Docker and the NVIDIA container toolkit, then prove the card reaches a container:

```bash
docker run --rm --gpus all nvidia/cuda:12.9.0-base-ubuntu24.04 \
  nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
```

Provision the speech models under one directory (`AUDIO_MODELS_DIR`): `audiocpp`, `kokoro`, `piper`
and `supertonic`, from the sources in `AUDIO_TIER.md`. The conversion model and its assets go in
their own directory; `vctk-p225.pth` is the pilot's. Audio models usually sit on the working
drive, which is re-provisionable and not backed up.

Start the audio tier, bound to loopback because the tailnet serve mapping reaches it locally:

```bash
AUDIO_BIND_ADDR=127.0.0.1 AUDIO_MODELS_DIR=<audio-models-dir> \
  docker compose -f docker-compose.audio.yml up -d --build \
  audiocpp stt-proxy gateway tts-proxy kokoro piper supertonic
```

Start the conversion project with the GPU override and the model the activation sidecar keeps
active. The service holds the active model in memory only, so the sidecar polls
`/api/models/active` and re-activates the named model whenever the answer is no — after a
container restart and after a host reboot:

```bash
OVC_MODELS_DIR=<ovc-models-dir> OVC_MODEL=vctk-p225.pth OVC_TAG=cpu \
  docker compose -f docker-compose.ovc.yml -f docker-compose.ovc.gpu.yml up -d --build
```

The card is 4 GB: transcription holds about 3 GB and conversion about 0.7 GB, leaving roughly
0.5 GB free. That margin is why the two do not always coexist; `OVC_REQUIRED=false` delivers the
unconverted audio and reports the failure rather than failing the turn.

Join the machine to the tailnet, tag it, and expose the loopback ports with `tailscale serve`.
Nothing is published on a public hostname:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --advertise-tags=tag:speech-host --hostname=<speech-node> --accept-dns
sudo tailscale serve --bg --tcp=8080 tcp://127.0.0.1:8080
sudo tailscale serve --bg --tcp=8082 tcp://127.0.0.1:8082
sudo tailscale serve --bg --tcp=8085 tcp://127.0.0.1:8085
tailscale serve status
```

Apply the ACL in the admin console's Access controls. The services have no authentication of their
own, so the tailnet and this rule are the boundary:

```json
{
  "tagOwners": {
    "tag:gadget-app": ["autogroup:admin"],
    "tag:speech-host": ["autogroup:admin"]
  },
  "acls": [
    {"action": "accept", "src": ["tag:gadget-app"], "dst": ["tag:speech-host:8080,8082,8085"]}
  ]
}
```

The machine must stay awake and online whenever the deployment is in use; sleeping it removes
transcription, synthesis and conversion together.

The model names under the conversion models directory are the operator's; `vctk-p225.pth` is the
pilot's. Point the runtime at the conversion endpoint in `/etc/gadget/api.env` and restart
`gadget-api`:

```ini
OVC_URL=http://<speech-node>:8085
OVC_MODEL=vctk-p225.pth
OVC_TIMEOUT_MS=60000
OVC_REQUIRED=false
VOICE_AGENT_OVC_PITCH_SHIFT=12
VOICE_AGENT_OVC_FORMANT_SHIFT=10
VOICE_AGENT_OVC_F0_METHOD=rmvpe
```

Also add these lines to the `api.env` heredoc inside `/usr/local/bin/gadget-secrets.sh`.
That script rewrites `/etc/gadget/api.env` at every boot, so a line added only to the file is
silently dropped when the host is stopped and started again — the deployment then reports
`configured: false` and every reply, including the console's audition, is the provider's own
voice. After changing the script, restart `gadget-secrets` and `gadget-api`.

Do not add `audio` or `ovc` entries to `ops.local.json`: the speech tier is not started or stopped
by the operator tool, and a session start cannot reach it.

## 9. Enable and seed

The deploy in §8 already started each unit. Enable them across reboots, and reload Caddy once its
configuration is in place:

```bash
sudo systemctl enable gadget-console gadget-api gadget-bridge
sudo systemctl reload caddy
```

The schema was created by `deploy console --migrate` in §8. What remains is the runtime record the
agents point at — loopback, and the token from the secret:

```bash
sudo bash -c 'set -a; . /etc/gadget/console.env; . /etc/gadget/api.env; set +a; \
  cd /srv/gadget-console/current && RUNTIME_URL=http://127.0.0.1:4000 \
  RUNTIME_TOKEN="$API_AUTH_TOKEN" npm run seed:runtime'
```

The deployment also publishes its built-in STT, TTS and LLM providers. They are the only providers
an owner uses; seed them once with the deployment's own endpoints and key. The list carries a
secret, so write it to a root-only file, seed from it, and remove it — the key is encrypted before
it is stored and the seed prints no key:

```bash
sudo install -m 600 /dev/null /root/provider-seed.json
sudo tee /root/provider-seed.json >/dev/null <<'JSON'
[
  {"kind":"llm","name":"<model name>","baseUrl":"<openai-compatible url>","model":"<model>","apiKey":"<key>","default":true},
  {"kind":"stt","name":"Local STT","baseUrl":"http://<speech-node>:8080","model":"stt","default":true},
  {"kind":"tts","name":"Local TTS","baseUrl":"http://<speech-node>:8082","model":"piper","voice":"<voice>","default":true}
]
JSON
sudo bash -c 'set -a; . /etc/gadget/console.env; set +a; cd /srv/gadget-console/current; \
  PROVIDER_SEED="$(cat /root/provider-seed.json)" npm run seed:providers'
sudo rm -f /root/provider-seed.json
```

Re-running the seed with the same list adds nothing; an `llm` entry with no `apiKey` keeps the
stored key; a provider the list no longer names is left in place rather than deleted.

## 10. Budget

Budgets are in the billing account's currency; the pilot's account is in VND, so 60 USD is
1,500,000.

```bash
gcloud billing budgets create --billing-account=<ACCOUNT_ID> --display-name="gadget pilot" \
  --budget-amount=1500000VND \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

## 11. Checklist

On the host, each of these is a thing that silently does nothing when it is wrong:

```bash
systemctl is-active gadget-console gadget-api gadget-bridge caddy
curl -s localhost:3001/health              # {"ok":true,"database":"reachable"}
curl -s localhost:4000/health              # {"status":"ok",...}
curl -s http://127.0.0.1:8003/             # ota https://…, ws wss://…
```

From your machine, which is the only place that sees the deployment as a gadget does:

```bash
curl -I https://<console-host>                                  # 200, and a valid certificate
curl -s -H "device-id: <any-identifier>" https://<bridge-host>/xiaozhi/ota/
                                                                # websocket.url is wss://<bridge-host>/xiaozhi/v1/
curl -s -m 5 http://<bridge-host>:8001                          # must time out
curl -s -m 5 http://<bridge-host>:8003                          # must time out
```

The device page of a claimed gadget then lists its tools; a page that lists none is the console
refusing the report, and the bridge's log says why.

The remaining steps are product, not infrastructure: create the first account, grant it admin
(`npm run role -- <email> admin`), seed the runtime and the built-in providers (§9), let a gadget
receive its activation code and claim it, then as the owner create a personality (name,
language, voice and voice style), hear it, save it, and assign it to the gadget on its card. An
admin approves the claim at `/admin/claims`.

## What this document still does not cover

- The firmware: its OTA address must be `https://<bridge-host>/xiaozhi/ota/`, which is a build-time
  value in the XiaoZhi configuration.
- The GPU driver and the container toolkit are prerequisites on the operator's machine, and one
  4 GB card carries transcription and conversion together. The section above installs them; a
  machine without the driver falls back to CPU conversion, which is slow enough to notice.
- A personality created from the console has a neutral name and prompt for its language; the
  owner edits them under Advanced.
