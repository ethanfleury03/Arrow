# RIP Bridge Phase 2 (Real PES Wiring + First-Print Safety Gates)

## What is real now

- Pluggable real client-factory loading with local default entrypoint:
  - `bridge/real-client-factory.local.js`
- Read-only real PES handshake path (`getStatus` / `getProductInfo`) is exercised in connectivity checks.
- Controlled real command path wiring for:
  - `clearQueue` → `clearJobQueue`
  - `initialiseEngine` → `initialiseEngine`
  - `prepareToPrint` → `prepareToPrint`
  - `startPrinting` / `finishPrinting`
- Strict safety gates:
  - `RIP_BRIDGE_ENABLE_REAL_COMMANDS` (default `true`)
  - `RIP_BRIDGE_ENABLE_REAL_START_PRINT` (default `true`)
  - `RIP_BRIDGE_REAL_DRY_RUN` (default `false`, physical `startPrinting` allowed when real start gate is enabled)
- `POST /api/device/preflight` added for first-print readiness checklist.
- `/api/device/status` now reports:
  - gate state
  - operation allow/block map with reasons
  - last successful real PES call summary/timestamp

## Important limitation (explicit)

`submitJobData` is now wired to a practical EXTERNAL rip-mode path via `gborcat` in `bridge/real-client-factory.local.js`, but it remains fail-closed behind `MEMJET_ALLOW_DATA_SUBMISSION=true`.

Safety/ops notes:
- Missing/unreadable artifact file fails immediately.
- Job IDs are normalized to a 32-char ASCII token when needed (effective ID is logged).
- Default command uses: `gborcat -h <host> -c 1 -r 1 -j <jobId> -v <artifactPath>`.
- Optional port flag can be enabled with `MEMJET_GBORCAT_USE_PORT=1`.

---

## Endpoints

- `GET /api/health`
- `GET /api/device/status`
- `POST /api/device/preflight` body: `{ requireStartPrint?: boolean }`
- `POST /api/jobs`
- `POST /api/jobs/ingest`
- `GET /api/jobs/:jobId`
- `POST /api/jobs/:jobId/send`
- `POST /api/jobs/:jobId/cancel`
- `GET /api/queue`
- `GET /api/events`

---

## Environment variables (first real print attempt)

```bash
# bridge
export RIP_BRIDGE_HOST=127.0.0.1
export RIP_BRIDGE_PORT=8787

# kareela endpoint defaults discovered in lab
export MEMJET_MODE=real
export MEMJET_HOST=192.168.111.2
export MEMJET_COMMAND_PORT=13001
export MEMJET_EVENT_PORT=9231
export MEMJET_DATA_PORT=13001
# optional forced override (highest precedence; useful when UI/runtime profile is locked)
# export MEMJET_TARGET_HOST=192.168.111.2
# export MEMJET_TARGET_COMMAND_PORT=13001
# export MEMJET_TARGET_EVENT_PORT=9231
# export MEMJET_TARGET_DATA_PORT=13001
export MEMJET_PROTOCOL=thrift-compact
export MEMJET_TRANSPORT=framed

# real client factory (replace with your generated thrift wiring if needed)
export MEMJET_THRIFT_CLIENT_FACTORY=$PWD/bridge/real-client-factory.local.js

# backend selection
# default: local (python + gborcat on same machine as bridge)
export MEMJET_REAL_BACKEND=local

# first-attempt safety (recommended initial run)
export RIP_BRIDGE_ENABLE_REAL_COMMANDS=true
export RIP_BRIDGE_ENABLE_REAL_START_PRINT=false
export RIP_BRIDGE_REAL_DRY_RUN=true

# keep guarded by default; only enable for live data submission tests
export MEMJET_ALLOW_DATA_SUBMISSION=false

# optional local gborcat overrides for submitJobData
# export MEMJET_GBORCAT_BIN=/absolute/path/to/gborcat
# export MEMJET_GBORCAT_USE_PORT=1
# export MEMJET_SUBMIT_TIMEOUT_MS=30000
```

---

## First real print attempt runbook

1) Start bridge:

```bash
npm run bridge:start
```

2) Check status details:

```bash
curl -s http://127.0.0.1:8787/api/device/status | jq .details.diagnostics
```

3) Run preflight checklist:

```bash
curl -s -X POST http://127.0.0.1:8787/api/device/preflight \
  -H 'content-type: application/json' \
  -d '{"requireStartPrint":false}' | jq .
```

4) Ingest test artifact:

```bash
curl -s -X POST http://127.0.0.1:8787/api/jobs/ingest \
  -H 'content-type: application/json' \
  -d '{"filePath":"/absolute/path/to/test-artifact.gbor","copies":1}' | jq .
```

5) Send job in dry-run (real checks + sequence, no physical start):

```bash
curl -s -X POST http://127.0.0.1:8787/api/jobs/<JOB_ID>/send \
  -H 'content-type: application/json' \
  -d '{"copies":1}' | jq .
```

6) For physical first print (only when fully ready), switch gates:

```bash
export RIP_BRIDGE_ENABLE_REAL_START_PRINT=true
export RIP_BRIDGE_REAL_DRY_RUN=false
curl -s -X POST http://127.0.0.1:8787/api/device/preflight \
  -H 'content-type: application/json' \
  -d '{"requireStartPrint":true}' | jq .
```

---

## Windows operator: SSH backend quick setup (bridge on Windows, Memjet tooling on Linux)

`MEMJET_REAL_BACKEND=ssh` uses SSH to call a Linux-side wrapper command for all real operations:
`getStatus`, `clearJobQueue`, `initialiseEngine`, `prepareToPrint`, `submitJobData`, `startPrinting`, `finishPrinting`.

The bridge fails closed if any required SSH env var is missing.

```powershell
# --- required backend selector ---
$env:MEMJET_REAL_BACKEND = "ssh"

# --- required SSH connection ---
$env:MEMJET_SSH_HOST = "192.168.111.10"                # Linux RIP/control host
$env:MEMJET_SSH_USER = "memjet"
$env:MEMJET_SSH_KEY_PATH = "C:\Users\Operator\.ssh\memjet_ed25519"
$env:MEMJET_SSH_PORT = "22"

# --- required remote command template ---
# Placeholders available:
# {operation} {args_json} {args_json_escaped} {args_json_b64}
# {host} {commandPort} {eventPort} {dataPort}
# Recommended: wrapper accepts --op + --args-b64 and returns JSON on stdout.
$env:MEMJET_SSH_REMOTE_CMD_TEMPLATE = "/opt/arrow/bin/memjet-bridge-op --op {operation} --args-b64 {args_json_b64} --host {host} --command-port {commandPort} --event-port {eventPort} --data-port {dataPort}"

# --- optional SSH execution behavior ---
$env:MEMJET_SSH_BIN = "ssh"
$env:MEMJET_SSH_TIMEOUT_MS = "30000"

# existing bridge safety gates (unchanged)
$env:RIP_BRIDGE_ENABLE_REAL_COMMANDS = "true"
$env:RIP_BRIDGE_ENABLE_REAL_START_PRINT = "false"
$env:RIP_BRIDGE_REAL_DRY_RUN = "true"
$env:MEMJET_ALLOW_DATA_SUBMISSION = "false"
```

Notes:
- `submitJobData` now forwards `{ jobId, artifactPath }` to the Linux wrapper via SSH; local Windows Memjet Python bindings are not required in SSH mode.
- Artifact path must be readable from the bridge machine; the Linux wrapper should map/read it according to your deployment (shared path, mount, or copy step).

## Rollback / safe-disable

Immediate safe disable:

```bash
export RIP_BRIDGE_ENABLE_REAL_COMMANDS=false
export RIP_BRIDGE_ENABLE_REAL_START_PRINT=false
export RIP_BRIDGE_REAL_DRY_RUN=true
```

Or force simulation:

```bash
export MEMJET_MODE=stub
```
