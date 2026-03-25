# RIP UI Prototype (Offline-First + Phase 5 Stage 2 Job Submission Workspace)

Windows/Electron operator console for RIP + PES workflows with deterministic simulator behavior and guarded live integration hooks.

## What is now live (Phase 5 / Stage 2 / M36)
- Artwork Intake and Sheet Layout Preview now live in the **Job Submission** top tab.
- Job Submission now uses an Anyflow-inspired three-zone workspace:
  - left: intake + actions + placement controls
  - center: enlarged sheet/canvas preview focus
  - right: compact job queue and selected job/artwork info panel
- Printhead Controls tab now focuses on printhead/printer controls and live-status workflow only.
- Existing command wiring, guardrails, and single-page operator feel preserved.

## What is now live (Phase 5 / M31)
- One-page desktop operator layout tuned for single-viewport operation (no normal scroll in default desktop view).
- Center column now follows operator priority order:
  - Sheet Layout Preview (top, enlarged footprint for operator visibility)
  - Jobs (compact, dense operator table with reduced panel footprint)
- Jobs section updated to Anyflow-style single-line rows with practical columns:
  - Job (ID + short name)
  - Size
  - Mode
  - Count
  - Status
- Long values truncate with ellipsis while preserving full text in tooltips.
- Keyboard-friendly row focus/selection styling added without changing existing project color palette.
- Jobs table remains internally scrollable so all rows stay accessible despite reduced jobs panel height.
- Placement Controls moved directly under First Page Preview in the left Artwork Intake panel.
- Queue + Controls moved into the right sidebar as a dedicated tab.
- Right sidebar tab behavior now:
  - Queue + Controls
  - Live Status + Logs
- Queue + Controls tab is grouped for operator workflow using available controls:
  - Print Head Cleaning
  - Engine
  - Priming
  - Head
  - Job
  - Print Control
- Declog Mode section intentionally omitted in this milestone.
- Command Eligibility panel remains hidden from visible operator UI (guardrail logic still enforced in command gating).
- Existing Phase 4 safety behavior preserved (preflight gating, confirmations, read-only/mutating distinctions, audit hooks).

## What is now live (Phase 4 / M25)
- Operator profile + runtime config loader in Electron (`simulator-safe`, `kareela-lab`).
- Env + optional JSON config overlay (`RIP_UI_CONFIG_FILE`) with safe fallbacks.
- Hardened `thrift-cli` backend checks (missing/invalid binaries, host/port validation, actionable preflight errors).
- Data-plane submission scaffold (`submit-job`) with explicit **not-configured** behavior when no submitter is wired.
- Preflight gate in UI that must pass before `start` is allowed in live path.
- Operator audit trail append hooks for preflight, command attempts/results, and data-plane submission attempts.
- Signed operator identity metadata in audit rows (`operatorUsername`, `operatorBadgeId`, `signature`, `signatureVersion`).
- Browser mode still works with simulator fallback.

## Anyflow section mapping assumptions (M31)
- **Print Head Cleaning** → mapped to existing `clear` + `shutdown` controls (closest available head-safe/reset actions).
- **Engine** → mapped to existing polling/preflight controls (`Start Polling`, `Stop Polling`, `Run Preflight`).
- **Priming** → mapped to existing `initialise` + `prepare` commands.
- **Head** → mapped to existing `Run Recovery Scenario` as closest head-recovery workflow.
- **Job** → mapped to existing job actions (`Add Mock Job`, simulation/fault/recovery/discovery) + queue list.
- **Print Control** → mapped to existing print lifecycle commands (`start`, `finish`) + data-plane submit action.

## What is NOT fully live yet
- End-to-end printer-side validation still requires live PES/Kenmare environment testing.
- `RIP_DATA_SUBMITTER_BIN` fails closed when missing/unreadable.
- Preflight currently validates operator readiness + endpoint checks, not full PES engine state policy.

## Data submitter contract (M37)
- Backend enforces strict submit payload validation before invoking external data-plane adapter.
- Contract doc: `docs/DATA_SUBMITTER_CONTRACT.md`
- Deterministic harness adapter: `scripts/mock-data-submitter.js`
- Production submitter binary scaffold: `scripts/production-data-submitter.js`
  - default mode is deterministic **dry-run** spool bundling (no live printer required)
  - optional live execution when `RIP_SUBMIT_EXECUTE=1`
- Submitter evidence report generator: `scripts/submitter-report.js`
  - generates `dist/SUBMITTER_REPORT.json` + `dist/SUBMITTER_REPORT.md` from spool bundles

```bash
export RIP_DATA_SUBMITTER_BIN=$PWD/scripts/production-data-submitter.js
# Optional live handoff execution (keep off for offline tests)
# export RIP_SUBMIT_EXECUTE=1
```

## Startup instructions (bridge controls + RIP adapter jobs)

### 1) macOS / Linux (production path: HTTP bridge)
```bash
npm install
npm run bridge:start
# in a second terminal
export RIP_OPERATOR_PROFILE=kareela-lab
export RIP_BACKEND_MODE=bridge-http
export RIP_BRIDGE_HOST=127.0.0.1
export RIP_BRIDGE_PORT=8787
export RIP_ADAPTER_HOST=127.0.0.1
export RIP_ADAPTER_PORT=8081
npm start
```

### 2) Windows CMD (production path: HTTP bridge)
```cmd
npm install
start "RIP Bridge" cmd /k "npm run bridge:start"
set RIP_OPERATOR_PROFILE=kareela-lab
set RIP_BACKEND_MODE=bridge-http
set RIP_BRIDGE_HOST=127.0.0.1
set RIP_BRIDGE_PORT=8787
set RIP_ADAPTER_HOST=127.0.0.1
set RIP_ADAPTER_PORT=8081
npm start
```

### 3) Optional config file overlay
```bash
export RIP_UI_CONFIG_FILE=/absolute/path/to/rip-ui.config.json
```

Example config:
```json
{
  "defaults": { "pollIntervalMs": 1500 },
  "profiles": {
    "kareela-lab": { "host": "192.168.111.2", "commandPort": 13002 }
  }
}
```

### 4) Optional data-plane submit adapter hook
```bash
export RIP_DATA_SUBMITTER_BIN=$PWD/scripts/production-data-submitter.js
# optional overrides
# export RIP_SPOOL_OUT_DIR=$PWD/dist/spool
# export RIP_SUBMIT_EXECUTE=1
# export RIP_GBORCAT_BIN=/absolute/path/to/gborcat
```
If not set/readable, data-plane submit remains disabled and returns clear `not-configured` status.

### 5) Optional signed operator identity metadata
```bash
export RIP_OPERATOR_USERNAME=ethan
export RIP_OPERATOR_BADGE_ID=BADGE-42
export RIP_OPERATOR_IDENTITY_SECRET=replace-with-site-secret
```
These values are embedded into each audit row with a deterministic SHA-256 signature for traceability.

## RIP Bridge v1 scaffold
- Local bridge service scaffold added under `bridge/`.
- API + SSE contract documented in `docs/RIP_BRIDGE_V1.md`.
- Start it with:
```bash
npm run bridge:start
```
- Added first-print readiness endpoint: `POST /api/device/preflight`.
- Real PES command path is now gate-controlled (defaults are production/real):
  - `RIP_BRIDGE_ENABLE_REAL_COMMANDS=true` (default)
  - `RIP_BRIDGE_ENABLE_REAL_START_PRINT=true` (default)
  - `RIP_BRIDGE_REAL_DRY_RUN=false` (default; physical start allowed)
  - `MEMJET_ALLOW_DATA_SUBMISSION=true` (default)
- Real client backend selector:
  - `MEMJET_REAL_BACKEND=local` (default, existing local Python+gborcat path)
  - `MEMJET_REAL_BACKEND=ssh` (remote Linux wrapper over SSH; see `docs/RIP_BRIDGE_V1.md` for required env)
- UI Send Job now attempts `POST /api/jobs/:jobId/send` with copies and falls back gracefully if the bridge is unavailable.
- Printhead/maintenance controls (cleaning, priming/depriming, wipers, cap/raise/printhead motion, pause/start/finish) require host network reachability to the Kareela PES command endpoint (`host:commandPort`). If unreachable (for example on this Mac mini), commands fail closed with actionable errors; they are intended to run on the Windows host connected to the printer.

## Deterministic checks
```bash
npm run test:bridge
npm run test:backend
npm run test:runtime-config
npm run test:hookup
npm run test:submitter:prod
npm run test:submitter:report
npm run test:ops
npm run test:config
npm run report:submitter
npm run report:config
# Optional deterministic timestamp pin for ops snapshot
RIP_SNAPSHOT_TIMESTAMP=2026-03-13T14:31:00.000Z npm run report:ops
npm run ci
```

## Safety model
- No auto-fired mutating commands.
- Command allowlist enforcement in Electron backend.
- `start` blocked unless preflight passes.
- Missing live wiring fails closed with actionable errors.
- No fake success responses for real data-plane submission.
