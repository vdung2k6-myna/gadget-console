# Provisioning

Building the pilot from nothing: the network, the database, the host, the four secrets, the three
systemd units and the two Caddy sites. `DEPLOYMENT.md` says what the result is and `RUNBOOK.md` how
to operate it; this file is the one that assumes none of it exists.

Run it in a bash shell with `gcloud` authenticated (Cloud Shell is enough). Nothing here is
idempotent by design — a second run against existing resources fails loudly, which is the right
answer for a rebuild.

```bash
export PROJECT=<your-project-id>
export REGION=asia-southeast1
export ZONE=asia-southeast1-a
export DOMAIN=example.com          # the pilot uses example.com
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
ENV

cat > /etc/gadget/bridge.env <<ENV
BRIDGE_CONSOLE_URL=http://127.0.0.1:3001
BRIDGE_CONSOLE_TOKEN=$(secret bridge-token)
BRIDGE_PUBLIC_HOST=<bridge-host>
BRIDGE_PUBLIC_URL=https://<bridge-host>
ENV

chmod 600 /etc/gadget/*.env
SCRIPT
sudo chmod +x /usr/local/bin/gadget-secrets.sh
```

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
    api)     DESC="Gadget runtime (adaptive-interview-api)"; DIR=/srv/adaptive-interview-api ;;
    console) DESC="Gadget console";                          DIR=/srv/gadget-console ;;
    bridge)  DESC="Gadget bridge";                           DIR=/srv/gadget-bridge ;;
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

## 8. The three trees

There is no repository and no GitHub credential on the host. From your machine, package each
committed revision and copy it over:

```bash
git -C <repo> archive --format=tar.gz -o "$TEMP/<service>.tar.gz" HEAD
gcloud compute scp "$TEMP/<service>.tar.gz" gadget-app:/tmp/<service>.tar.gz \
  --zone=$ZONE --tunnel-through-iap
```

On the host, as the account the units run as:

```bash
sudo mkdir -p /srv/gadget-console && sudo chown "$USER":"$USER" /srv/gadget-console
tar xzf /tmp/console.tar.gz -C /srv/gadget-console
cd /srv/gadget-console && npm ci && npm run build
```

The runtime and the bridge are the same without the build (`npm start` runs `tsx`). Extract and
build as the user, not with `sudo`: a root-owned tree breaks the next build.

## 9. Start and seed

```bash
sudo systemctl daemon-reload
sudo systemctl enable gadget-secrets gadget-console gadget-api gadget-bridge
sudo systemctl restart gadget-secrets
sudo systemctl start gadget-console gadget-api gadget-bridge
sudo systemctl reload caddy

# schema
sudo bash -c 'set -a; . /etc/gadget/console.env; set +a; cd /srv/gadget-console && npx drizzle-kit migrate'

# the runtime record the agents point at — loopback, and the token from the secret
sudo bash -c 'set -a; . /etc/gadget/console.env; . /etc/gadget/api.env; set +a; \
  cd /srv/gadget-console && RUNTIME_URL=http://127.0.0.1:4000 \
  RUNTIME_TOKEN="$API_AUTH_TOKEN" npm run seed:runtime'
```

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
(`npm run role -- <email> admin`), let a gadget receive its activation code, claim it, create the
`stt`/`tts`/`llm` profiles, and bind an agent with empty topics.

## What this document still does not cover

- The firmware: its OTA address must be `https://<bridge-host>/xiaozhi/ota/`, which is a build-time
  value in the XiaoZhi configuration.
- Where the speech providers run. The pilot pointed them at a quick tunnel from the developer's
  machine; a deployment that must survive a restart needs its own.
