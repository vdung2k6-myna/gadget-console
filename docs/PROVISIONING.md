# Provisioning

Building the pilot from nothing: the network, the database, the app host, the speech host, the four
secrets, the systemd units and the two Caddy sites. `DEPLOYMENT.md` says what the result is and
`RUNBOOK.md` how to operate it; this file is the one that assumes none of it exists.

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
  --network=gadget-vpc --region="$REGION" --range=10.10.0.0/24

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

for s in bridge-token runtime-token console-llm-key-secret gadget-db-password; do
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

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
<console-host> {
	reverse_proxy 127.0.0.1:3001
}

<bridge-host> {
	reverse_proxy /xiaozhi/ota* 127.0.0.1:8003
	reverse_proxy /xiaozhi/v1* 127.0.0.1:8001
}
EOF
```

Both certificates are issued automatically over HTTP-01; port 80 must stay open.

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

### The speech host (STT, TTS and conversion)

`gadget-gpu` is one GPU VM in the same VPC and subnet, tag `gpu`, `g2-standard-4` (4 vCPU, 16 GB,
one NVIDIA L4 with 24 GB), Ubuntu 22.04, a 100 GB boot disk and no service account. It runs the
STT proxy with `audiocpp` on CUDA, the TTS gateway and engines, and the conversion service. The
L4 is the reason: the two models together use about 4 GB, so one card carries the whole speech
tier.

The GPU machine type is not available in every zone at every moment; the pilot uses
`asia-southeast1-b` because `-a` had no capacity. Create it there:

```bash
export GPU_ZONE=asia-southeast1-b

gcloud compute instances create gadget-gpu --zone=$GPU_ZONE --machine-type=g2-standard-4 \
  --maintenance-policy=TERMINATE --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=100GB --boot-disk-type=pd-balanced \
  --network=gadget-vpc --subnet=gadget-subnet --tags=gpu \
  --no-service-account --no-scopes

# the speech endpoints, only from the app host
gcloud compute firewall-rules create gadget-gpu-api --network=gadget-vpc \
  --direction=INGRESS --action=ALLOW --rules=tcp:8080,tcp:8082,tcp:8085 \
  --source-tags=app --target-tags=gpu --priority=900
# SSH through IAP only: deny the world, allow the IAP range above it
gcloud compute firewall-rules create gadget-gpu-deny-ssh --network=gadget-vpc \
  --direction=INGRESS --action=DENY --rules=tcp:22 \
  --source-ranges=0.0.0.0/0 --target-tags=gpu --priority=1000
gcloud compute firewall-rules create gadget-gpu-iap-ssh --network=gadget-vpc \
  --direction=INGRESS --action=ALLOW --rules=tcp:22 \
  --source-ranges=35.235.240.0/20 --target-tags=gpu --priority=900
```

The VPC has no Cloud NAT, so give the VM a temporary external address for the install and the
build, and remove it afterwards:

```bash
gcloud compute instances add-access-config gadget-gpu --zone=$GPU_ZONE \
  --access-config-name=external-nat
```

Install the NVIDIA driver (CUDA 13 needs 580 or newer) and the container toolkit. The kernel is
built with gcc-12; DKMS fails without it, and the failure is only visible in
`/var/lib/dkms/nvidia/*/build/make.log`:

```bash
sudo apt-get update && sudo apt-get install -y build-essential gcc-12 \
  linux-headers-$(uname -r) ca-certificates wget
sudo update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-12 100
sudo update-alternatives --install /usr/bin/cc cc /usr/bin/gcc-12 100
cd /tmp && wget -q https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
sudo apt-get update && sudo apt-get install -y cuda-drivers-580
sudo reboot
```

After the reboot, install Docker from Docker's repository as in §7, then the container toolkit,
and prove the card reaches a container:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
sudo docker run --rm --gpus all nvidia/cuda:12.9.0-base-ubuntu22.04 \
  nvidia-smi --query-gpu=name --format=csv,noheader
```

Ship the audio tree and the models, then start the whole tier — including `audiocpp`:

```bash
git -C <repo> archive --format=tar.gz -o "$TEMP/audio-tier.tar.gz" HEAD
gcloud compute scp "$TEMP/audio-tier.tar.gz" gadget-gpu:/tmp/ --zone=$GPU_ZONE --tunnel-through-iap
tar -C <repo>/audio-models -czf "$TEMP/audio-models.tar.gz" kokoro piper supertonic
gcloud compute scp "$TEMP/audio-models.tar.gz" gadget-gpu:/tmp/ --zone=$GPU_ZONE --tunnel-through-iap

# on the host
sudo mkdir -p /srv/audio-tier /srv/audio-models
sudo tar xzf /tmp/audio-tier.tar.gz -C /srv/audio-tier
sudo tar xzf /tmp/audio-models.tar.gz -C /srv/audio-models
# the ASR model, pinned and checksummed by the service's own script
cd /srv/audio-tier && sudo python3 audiocpp-service/download_models.py --dest /srv/audio-models/audiocpp
cd /srv/audio-tier
sudo env AUDIO_BIND_ADDR=<gpu-private-ip> AUDIO_MODELS_DIR=/srv/audio-models \
  docker compose -f docker-compose.audio.yml up -d --build \
  audiocpp stt-proxy gateway tts-proxy kokoro piper supertonic
```

The gateway answers at `http://gadget-gpu:8082/health` and the STT proxy at `:8080`; the app host
resolves the instance's internal DNS name, and only its tag may reach the ports.

The conversion service is the second project on the same host. Ship its service, both compose
files and the model directory, then build and start with the GPU override:

```bash
gcloud compute scp --recurse --tunnel-through-iap ovc-service gadget-gpu:/tmp/ --zone=$GPU_ZONE
gcloud compute scp --tunnel-through-iap docker-compose.ovc.yml docker-compose.ovc.gpu.yml \
  gadget-gpu:/tmp/ --zone=$GPU_ZONE
gcloud compute scp --recurse --tunnel-through-iap <ovc-models-dir> gadget-gpu:/tmp/ --zone=$GPU_ZONE
# on the host
sudo mkdir -p /srv/ovc
sudo mv /tmp/ovc-service /srv/ovc/
sudo mv /tmp/docker-compose.ovc.yml /tmp/docker-compose.ovc.gpu.yml /srv/ovc/
sudo mv /tmp/<ovc-models-dir> /srv/ovc-models
cd /srv/ovc
sudo env OVC_TAG=cpu docker compose -f docker-compose.ovc.yml build
sudo env OVC_MODELS_DIR=/srv/ovc-models OVC_BIND_ADDR=0.0.0.0 OVC_PUBLISHED_PORT=8085 \
  OVC_TAG=cpu docker compose -f docker-compose.ovc.yml -f docker-compose.ovc.gpu.yml up -d
```

Remove the temporary address, then install the activation unit. The service keeps its active
model in memory only, so this is what makes a restart or a stopped VM come back converting:

```bash
gcloud compute instances delete-access-config gadget-gpu --zone=$GPU_ZONE \
  --access-config-name=external-nat
```

```bash
#!/bin/bash
# /usr/local/bin/gadget-ovc-activate.sh
set -uo pipefail
for i in $(seq 1 120); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 \
    http://127.0.0.1:8085/api/models/active 2>/dev/null || true)
  [ "$code" = "200" ] && break
  sleep 2
done
curl -sf -m 240 -X POST http://127.0.0.1:8085/api/models/vctk-p225.pth/activate >/dev/null
curl -s -m 5 http://127.0.0.1:8085/api/models/active | grep -q '"active":true'
```

```ini
# /etc/systemd/system/gadget-ovc-activate.service
[Unit]
Description=Activate the OVC voice-conversion model
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/gadget-ovc-activate.sh

[Install]
WantedBy=multi-user.target
```

```bash
sudo chmod 755 /usr/local/bin/gadget-ovc-activate.sh
sudo systemctl daemon-reload
sudo systemctl enable --now gadget-ovc-activate.service
```

The model names under `/srv/ovc-models` are the operator's; `vctk-p225.pth` is the pilot's. Point
the runtime at the host in `/etc/gadget/api.env` and restart `gadget-api`:

```ini
OVC_URL=http://gadget-gpu:8085
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
voice. After changing the script, append the lines to the running file (or re-run the script)
and restart `gadget-api`.

Add the host to `ops.local.json` so a session starts, stops and reports it. Both entries name the
same instance; the tool tolerates the second start or stop:

```json
"audio": {
  "instance": "gadget-gpu",
  "zone": "asia-southeast1-b",
  "healthUrl": "http://gadget-gpu:8082/health"
},
"ovc": {
  "instance": "gadget-gpu",
  "zone": "asia-southeast1-b",
  "healthUrl": "http://gadget-gpu:8085/api/models/active"
}
```

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
  {"kind":"stt","name":"Speech to text","baseUrl":"http://gadget-gpu:8080","model":"stt","default":true},
  {"kind":"tts","name":"Voice","baseUrl":"http://gadget-gpu:8082","model":"piper","voice":"<voice>","default":true}
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
- The GPU driver and the container toolkit are prerequisites on the speech host, and one L4 host
  carries the whole speech tier. The provisioning above installs them; a host without the driver
  falls back to CPU conversion, which is slow enough to notice.
- A personality created from the console has a neutral name and prompt for its language; the
  owner edits them under Advanced.
