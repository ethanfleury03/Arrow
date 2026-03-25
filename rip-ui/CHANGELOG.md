# Changelog

## 2026-03-13
- Completed **M43** read-only discovery lock UX milestone.
- Added explicit Discovery Lock toggle in the Print Control area (`src/index.html`).
- Updated command eligibility gating (`src/app.js`) so mutating print commands are blocked whenever `config.readOnlyDiscovery` is enabled.
- Added visible mode cues for lock state (simulation/mode badges + on-screen hint text).
- Expanded deterministic harness coverage with new snapshot:
  - `tests/snapshots/discovery-mode-toggle.json`
  - `tests/ui-harness.test.js`
- Verified with: `npm run test:harness`.

## 2026-03-13
- Completed **M42** deterministic config template audit milestone.
- Added `scripts/config-audit.js` to validate `config.template.json` shape and safety defaults.
- Added deterministic config audit artifacts:
  - `dist/CONFIG_AUDIT.json`
  - `dist/CONFIG_AUDIT.md`
- Added deterministic regression coverage: `tests/config-audit.test.js`.
- Added npm/CI wiring: `test:config`, `report:config`.

## 2026-03-13
- Completed **M41** deterministic Arrange quick-presets milestone for Anyflow-style operator repeatability.
- Added offline/local preset slots in Job Submission Arrange panel:
  - Save/Apply/Clear for slot A
  - Save/Apply/Clear for slot B
- Presets capture and restore both placement/layout values and arrange copy/gap settings.
- Added deterministic UI harness coverage for preset save/apply behavior:
  - `tests/ui-harness.test.js`
  - `tests/snapshots/preset-apply.json`

## 2026-03-13
- Completed **M41** deterministic ops snapshot timestamp override milestone.
- Updated `scripts/ops-snapshot.js`:
  - added `RIP_SNAPSHOT_TIMESTAMP` environment override for reproducible artifact timestamps
  - retained default runtime behavior using current ISO timestamp when override is unset
- Updated regression coverage in `tests/ops-snapshot.test.js` to run with a pinned timestamp and assert deterministic output.
- Updated `README.md` deterministic checks with `test:ops` and optional timestamp-pinned `report:ops` invocation.

## 2026-03-13
- Completed **M40** deterministic completion-guard milestone for cron handoff readiness.
- Added `scripts/completion-guard.js` to verify:
  - required release/handoff artifacts exist
  - `TODO.md` contains no unchecked checklist items
- Added deterministic regression coverage: `tests/completion-guard.test.js`.
- Added npm wiring:
  - `test:completion`
  - `guard:completion`
  - CI now includes completion test and final completion guard step.

## 2026-03-13
- Added top-banner **Important Controls** strip with:
  - 1Gb and 10Gb outline wifi-style ethernet indicators (10Gb visually larger/emphasized)
  - ON/OFF visual states (green for on, gray/desaturated for off)
  - Single auto-send play/pause toggle with accessible pressed state
- Added compact top-right **global Online/Offline indicator** above tab buttons with:
  - green dot + "Online" and red dot + "Offline"
  - `role="status"`, `aria-live`, and dynamic `aria-label`
  - existing status source preference (`state.status.connection`) with explicit UI placeholder fallback
- Implemented lightweight auto-send queue behavior:
  - when enabled and printer is idle with queued jobs, next job auto-dispatches
  - when disabled, new jobs remain queued (no auto-dispatch)
  - disabling auto-send does not interrupt active print
- Added accessibility labels/tooltips for connectivity indicators and auto-send toggle.

## 2026-03-13
- Completed **M39** deterministic submitter spool evidence reporting milestone.
- Added `scripts/submitter-report.js` to validate dry-run/live spool bundles and emit:
  - `dist/SUBMITTER_REPORT.json`
  - `dist/SUBMITTER_REPORT.md`
- Added regression coverage in `tests/submitter-report.test.js`.
- Added npm/CI wiring: `report:submitter`, `test:submitter:report`.
- Updated docs/checklists (`README.md`, `BUILD_NOTES.md`, `HOOKUP_CHECKLIST.md`, `TODO.md`).
- Bumped version metadata to `0.10.13`.

## 2026-03-13
- Completed **M38 / Stage 3** Job Submission right-rail Arrange/Layout sidebar.
- Replaced the Job Submission right sidebar with tabbed **Arrange** and **Layout** panels (Arrange active by default).
- Implemented Arrange groups focused on daily controls:
  - Alignment icon-button row (left/center/right + top/middle/bottom)
  - Size controls (Width/Height with mm units) and X/Y position inputs
  - Rotation angle + Flip H / Flip V actions
  - Gap Size horizontal/vertical inputs
  - Copy controls with count/spacing fields, interval-including-image-size checkbox, and guarded Apply action
- Restored queue table + selected job snapshot to **Printhead Controls** (Queue + Controls tab) per operator workflow correction.
- Kept **Job Submission** focused on Artwork Intake + Sheet Layout Preview + Arrange/Layout right rail controls.
- Preserved existing intake/preview/queue interactions and command safety behavior without backend feature additions.
- Updated version metadata to `0.10.12`.

## 2026-03-13
- Completed **M37** production data-plane submitter scaffold milestone.
- Added `scripts/production-data-submitter.js` as contract-compatible `RIP_DATA_SUBMITTER_BIN` target.
  - deterministic default dry-run mode writes spool artifacts (`submit-request.json`, `submit-plan.json`, `receipt.json`) under `dist/spool/<jobId>/`
  - optional explicit live handoff path via `RIP_SUBMIT_EXECUTE=1` with captured execution receipt
- Added deterministic regression coverage: `tests/production-data-submitter.test.js`.
- Updated operator docs/runbooks (`README.md`, `BUILD_NOTES.md`, `HOOKUP_CHECKLIST.md`) and milestone tracking (`TODO.md`).
- Bumped version metadata to `0.10.11`.

## 2026-03-13
- Completed **M36 / Stage 2** Job Submission workspace refactor.
- Moved **Artwork Intake** and **Sheet Layout Preview** out of Printhead Controls and into **Job Submission**.
- Replaced Job Submission placeholder with Anyflow-inspired tri-pane operator layout:
  - left: intake + job actions + placement controls
  - center: enlarged sheet layout preview
  - right: job queue table + compact selected job/artwork info panel
- Kept Printhead Controls command workflow intact, with controls and live-status tabs preserved.
- Preserved guardrails, command logic, and one-page operator UX (internal panel scrolling only).
- Updated version metadata to `0.10.10`.

## 2026-03-13
- Completed **M35** audit log viewer/export + retention controls.
- Added deterministic audit viewer controls in `src/index.html` + `src/app.js`:
  - filter selector (`all`, `command`, `preflight`, `submit-job`)
  - retention cap input (`10-1000`) with explicit apply/prune action
  - export buttons for filtered audit entries (JSON + NDJSON)
- Added audit stats summary (total/showing/retention) and widened preview window to latest 20 matching rows.
- Preserved offline-only deterministic behavior (no live printer dependency).

## 2026-03-13
- Completed **M34** signed operator identity metadata for audit trails.
- Added runtime config fields for operator identity overlays (`operatorUsername`, `operatorBadgeId`, `operatorIdentitySecret`) including env/file-default precedence.
- Added backend audit signing envelope with deterministic `sha256-v1` signatures persisted per NDJSON audit row.
- Added deterministic tests covering runtime identity config and signed audit metadata emission.
- Updated config template + README hookup guidance for operator identity variables.

## 2026-03-13
- Completed **Stage 1** primary workspace shell with persistent top-banner tabs:
  - **Printhead Controls**
  - **Job Submission**
- Kept the existing operator screen fully under **Printhead Controls** with default active state to preserve load-time workflow.
- Added an intentionally empty **Job Submission** panel with a clean `Coming soon` placeholder.
- Added accessible ARIA tab semantics and keyboard navigation (Left/Right/Home/End) for the new top tabs.
- Preserved one-page/no-scroll desktop behavior, existing theme, and all existing command/safety wiring.
- Updated version metadata to `0.10.9`.

## 2026-03-13
- Completed **M33** PES state-aware preflight gating.
- Expanded preflight beyond basic endpoint/artwork checks to include live-status quality gates:
  - stale telemetry detection using `pollIntervalMs` freshness window
  - engine readiness gate (`READY`/`IDLE`/`PRINTING` accepted)
  - active fault gate via `liveStatus.faults`
- Added deterministic regression coverage in `tests/preflight-status-gates.test.js` for fail/pass preflight status scenarios.
- Updated TODO gap tracking to mark PES state-aware preflight milestone complete.

## 2026-03-13
- Completed **M32** right-sidebar industrial polish pass for operator controls.
- Standardized right-sidebar controls to a unified neutral button system with consistent sizing/spacing and muted disabled state.
- Added consistent red armed/active state behavior for command controls based on eligibility readiness.
- Normalized Queue + Controls sections into consistent card blocks with aligned button grids (1/2/3-column as appropriate).
- Preserved requested Queue + Controls groups and kept **Declog Mode** absent.
- Simplified Live Status + Logs for at-a-glance operation by emphasizing summary cards and collapsing verbose readouts into `details` sections.
- Removed duplicate center-panel control IDs by assigning unique top-row IDs and wiring them explicitly (prevents ambiguous DOM bindings).
- Preserved command guardrails, preflight/eligibility checks, confirmations, audit hooks, and one-page/no-scroll desktop layout.
- Updated version metadata to `0.10.8`.

## 2026-03-13
- Completed **M31a** preview/jobs vertical rebalance follow-up.
- Increased **Sheet Layout Preview** visual footprint in center column.
- Reduced **Jobs** panel height while keeping jobs table body internally scrollable for row access.
- Preserved one-page/no-scroll operator layout and compact UX behavior.
- Updated version metadata to `0.10.7`.

## 2026-03-13
- Completed **M31** placement/queue section swap for operator workflow clarity.
- Moved **Placement Controls** under **First Page Preview** in left Artwork Intake panel.
- Added dedicated right-sidebar tab: **Queue + Controls** (with keyboard-accessible tab semantics preserved).
- Reorganized Queue + Controls into Anyflow-inspired groups using existing command wiring:
  - Print Head Cleaning
  - Engine
  - Priming
  - Head
  - Job
  - Print Control
- Explicitly omitted **Declog Mode** section per request.
- Preserved one-page operator layout behavior, compact Jobs table, and existing preflight/eligibility/confirmation guardrails.
- Updated docs/version tracking (`README.md`, `TODO.md`, `package.json`).
- Bumped version to `0.10.6`.

## 2026-03-13
- Completed **M30** compact Jobs grid redesign (Anyflow-style dense operator table).
- Replaced tall Jobs card presentation with single-line, compact table rows in center panel.
- Added at-a-glance job columns: Job, Size, Mode, Count, Status with sensible fallback placeholders (`—`).
- Added truncation + full-value tooltips for long job fields to preserve readability in dense mode.
- Added row selection state, keyboard activation (`Enter`/`Space`), and visible focus/selection styling in existing red/white/black palette.
- Kept one-page/no-scroll operator layout by making Jobs table body scroll within panel with sticky table headers.
- Preserved existing queue/send controls, command guardrails, preflight gating, and action wiring.
- Updated milestone tracking (`README.md`, `TODO.md`, `package.json`).
- Bumped version to `0.10.5`.

## 2026-03-13
- Completed **M29** data submitter contract hardening + deterministic harness.
- Added strict submit payload validation in Electron backend (`jobId`, `fileName`, `config`, `settings`) with explicit `BACKEND_SUBMIT_INVALID_PAYLOAD` failures.
- Added data submitter contract reference: `docs/DATA_SUBMITTER_CONTRACT.md`.
- Added deterministic mock submitter binary: `scripts/mock-data-submitter.js`.
- Added contract-focused tests: `tests/data-submitter-contract.test.js` and expanded backend submit-path assertions.
- Updated operator/runbook docs (`README.md`, `HOOKUP_CHECKLIST.md`, `BUILD_NOTES.md`, `TODO.md`, `package.json`).
- Bumped version to `0.10.4`.

## 2026-03-13
- Completed **M28** jobs-first layout reflow for operator usability.
- Moved **Queue + Controls** under the left-column **First Page Preview** (Artwork Intake panel).
- Removed visible **Command Eligibility** panel from the UI while keeping eligibility/preflight enforcement logic in place.
- Rebalanced center column to prioritize vertical room for **Jobs** while preserving one-page/no-scroll desktop behavior.
- Preserved right sidebar tabs and all Phase 4 command guardrails/audit hooks.
- Updated docs/version tracking (`README.md`, `TODO.md`, `package.json`).
- Bumped version to `0.10.3`.

## 2026-03-13
- Completed **M27** operator UX simplification: left sidebar is now Artwork Intake only.
- Removed left sidebar tab UI and hid Connection Wizard panel from the primary one-page operator screen.
- Kept one-page/no-scroll layout and existing command safety/guardrail behavior intact.
- Retained left-sidebar state hooks as no-op compatibility points for future settings relocation.
- Kept current light white/black/red visual theme (no blue accents introduced).
- Updated docs/version tracking (`README.md`, `TODO.md`, `package.json`).
- Bumped version to `0.10.2`.

## 2026-03-13
- Added left-sidebar tab system to mirror the right-sidebar UX while preserving one-page/no-scroll behavior.
- Left sidebar now uses accessible tabs for:
  - Connection Wizard
  - Artwork Intake
- Implemented ARIA semantics and keyboard support for left tablist:
  - `tablist` / `tab` / `tabpanel`
  - `aria-selected` / `aria-controls` / `aria-labelledby`
  - Left/Right/Home/End keyboard navigation and focus behavior
- Persisted selected left tab in app state/local storage (`state.ui.leftSidebarTab`) alongside right tab persistence.
- Kept current light white/black/red theme and preserved existing command safety/guardrail logic.
- Updated docs/version tracking (`README.md`, `TODO.md`, `package.json`).
- Bumped version to `0.10.1`.

## 2026-03-13
- Completed **M26 / Phase 5 One-Page Operator Layout**.
- Reworked app structure into a single-viewport desktop workspace (`src/index.html`, `src/styles.css`):
  - fixed-height app shell (`header` + `main`) with no default page scroll at desktop sizes
  - three-column layout with internal panel scrolling where needed
- Added right-sidebar tab system with conditional rendering:
  - tab 1: Placement Controls
  - tab 2: Live Status + Logs
  - only selected tab panel visible at a time
- Added accessibility semantics for tabs:
  - `tablist` / `tab` / `tabpanel` wiring with `aria-selected`, `aria-controls`, `aria-labelledby`
  - keyboard navigation (Left/Right/Home/End) and focus management
- Persisted selected sidebar tab in state (`state.ui.rightSidebarTab`) and synchronized UI in render cycle.
- Preserved Phase 4 command safety/guardrails and all existing action wiring/IDs.
- Kept light white/black/red visual theme, with no blue accents added.
- Updated docs/version tracking (`README.md`, `TODO.md`, `package.json`).
- Bumped version to `0.10.0`.

## 2026-03-13
- Completed **M25 / Phase 4 Live Hookup foundations**.
- Added runtime/operator profile loader:
  - `electron/runtime-config.js`
  - named profiles (`simulator-safe`, `kareela-lab`)
  - env + JSON overlay support with safe fallback
- Hardened Electron backend integration:
  - stronger thrift-cli validation and actionable setup failures
  - host/command-port live preflight validation before live actions
  - preserved command allowlist protections
- Added data-plane submission scaffold:
  - new `submitJob` bridge/backend contract
  - explicit `not-configured` behavior when no submitter binary is wired
  - no fake success for live submission
- Added preflight gate + audit trail:
  - UI preflight pass required before `start`
  - per-session audit append hooks for command/preflight/submission events
  - Electron audit file append (`rip-operator-audit.ndjson` in userData)
- Added/updated tests:
  - `tests/runtime-config.test.js`
  - updated `tests/bridge-contract.test.js`
  - updated `tests/rip-backend.test.js`
- Updated docs/runbooks:
  - `README.md`, `HOOKUP_CHECKLIST.md`, `TODO.md`
- Bumped version to `0.9.0`.

## 2026-03-13
- Completed **M24** deterministic consolidated ops-snapshot milestone.
- Added deterministic consolidated readiness generator:
  - `scripts/ops-snapshot.js`
  - produces `dist/OPS_SNAPSHOT.json` and `dist/OPS_SNAPSHOT.md`
  - evaluates preflight/scenarios/manifest/runbook/handoff/drill/hookup artifacts into one PASS/FAIL signal
- Added deterministic validation test:
  - `tests/ops-snapshot.test.js`
- Extended npm/CI scripts:
  - `npm run report:ops`
  - `npm run test:ops`
  - `npm run ci` now includes consolidated ops snapshot test/report
- Bumped version to `0.8.1`; updated `README.md` and `TODO.md` milestone tracking.

## 2026-03-13
- Completed **M23** light-theme redesign pass per operator feedback (too dark/blue-heavy).
- Replaced dark/blue-heavy UI palette with light-first surfaces in `src/styles.css`:
  - white/light panel backgrounds and neutral black/charcoal text structure
  - red remains the primary brand/action accent
  - removed blue-toned read-only styling and active UI accents
- Preserved safety semantics with non-blue affordances:
  - read-only actions now use neutral grayscale treatment (`btn-readonly`, legend)
  - mutating/danger actions remain red family (`cmd-mutating`, `btn-primary`, danger/blocked)
  - eligibility states remain visible via green/amber/red outlines (no blue)
- Updated layout preview canvas styling in `src/app.js` to light neutral sheet/background colors while keeping behavior unchanged.
- Bumped version to `0.8.0`; updated milestone tracking in `README.md` and `TODO.md`.

## 2026-03-13
- Completed **M22** second visual polish pass for Arrow operations branding.
- Added tighter branded header composition in `src/index.html` + `src/styles.css`:
  - dedicated Arrow brand-mark block and industrial "eyebrow" label area
  - refined title typography weights/sizes for clearer scan order
- Improved operations workflow hierarchy without behavior changes:
  - promoted primary operator actions (simulation/recovery, polling, prepare/start/finish command tier)
  - preserved explicit styling distinction for read-only checks and mutating commands
- Applied spacing rhythm/readability refinements:
  - normalized spacing tokens, panel cadence, and control group density
  - stronger card/log contrast and improved text legibility in dark conditions
- Kept safety semantics unchanged (`READY/WARN/BLOCKED`, confirmation flow, read-only vs mutating classes/eligibility logic untouched).
- Bumped version to `0.7.1`; updated milestone tracking in `README.md` and `TODO.md`.

## 2026-03-13
- Completed **M21** Arrow Systems visual redesign milestone.
- Applied a full red/black/white control-room theme across the UI with a cohesive tokenized palette in `src/styles.css`.
- Restyled global surfaces and controls: header, panels, forms, tables, badges, status cards, logs/previews, and file/drop zones.
- Preserved and clarified safety semantics:
  - read-only actions remain visually distinct (cool blue family)
  - mutating commands remain visually distinct (red family)
  - eligibility states continue to signal ready/warn/blocked via success/warn/danger accents
- Updated layout preview drawing colors in `src/app.js` to match Arrow-themed visuals while keeping behavior unchanged.
- Updated text cue in `src/index.html` from cyan artwork hint to red highlight.
- Bumped version to `0.7.0` and updated `README.md` milestone list.

## 2026-03-13
- Completed **M20 / Phase 3** live command-plane hardening milestone.
- UI/operator workflow hardening:
  - Added command eligibility panel (`READY/WARN/BLOCKED`) with remediation guidance.
  - Added explicit confirmation UX for mutating commands.
  - Added visual distinction for read-only checks vs mutating command buttons.
  - Added conservative soft-gating warning when telemetry is insufficient (`engineState=UNKNOWN`).
- Backend resilience hardening (`thrift-cli`):
  - Added subprocess timeout handling + forced kill path (`BACKEND_TIMEOUT`).
  - Strengthened malformed JSON diagnostics (`BACKEND_BAD_RESPONSE`).
  - Expanded non-zero exit diagnostics with action/code/signal/stdout/stderr context.
  - Added retry policy for safe read operations only (`get-status`), no retries for mutating commands.
  - Added live-command preflight check for required host config in thrift mode (`BACKEND_PREFLIGHT_FAILED`).
- Added deterministic backend resilience coverage:
  - `tests/rip-backend.test.js`
  - npm script: `npm run test:backend`
  - CI chain updated to include backend resilience tests.
- Updated docs + operators artifacts references:
  - `README.md`, `HOOKUP_CHECKLIST.md`, `TODO.md`.

## 2026-03-13
- Completed **M19** deterministic hookup acceptance milestone.
- Added deterministic hookup acceptance harness:
  - `tests/hookup-harness.test.js`
  - snapshot: `tests/snapshots/hookup-acceptance.json`
- Added deterministic hookup report generator:
  - `scripts/hookup-report.js`
  - outputs `dist/HOOKUP_REPORT.json` and `dist/HOOKUP_REPORT.md`
- Extended npm/CI scripts:
  - `npm run test:hookup`
  - `npm run report:hookup`
  - `npm run ci` now includes hookup acceptance + report steps
- Updated docs/trackers:
  - `TODO.md`, `README.md`, `HOOKUP_CHECKLIST.md`

## 2026-03-13
- Completed **M18** hookup phase 2 backend wiring milestone.
- Added production-oriented Electron backend adapter layer:
  - `electron/rip-backend.js`
  - adapter modes: `not-configured` (safe default), `simulator` (explicit), `thrift-cli` (real external bridge hook)
  - real non-destructive TCP endpoint probes for `rip:test-endpoint`
  - operator-command allowlist enforcement for backend command execution
- Refactored bridge handlers to backend-driven contract factory:
  - `electron/bridge-contract.js` now exports `createBridgeContract({ backend })`
  - structured actionable bridge errors (`code`, `message`, `details`) with main-process logging
- Updated Electron main wiring:
  - `electron/main.js` now creates backend + contract once and registers IPC handlers
- Improved renderer error surfacing:
  - actionable error parsing/logging for status polling, command execution, and endpoint probes
  - clearer user-visible command error text for backend-side failures
- Expanded deterministic bridge tests:
  - updated `tests/bridge-contract.test.js` for simulator mode + explicit not-configured failure behavior

## 2026-03-13
- Completed **M17** deterministic IPC bridge contract milestone.
- Extracted shared Electron bridge contract module:
  - `electron/bridge-contract.js`
  - centralizes deterministic handler behavior for status, command, and endpoint probe calls
- Updated Electron main-process IPC wiring:
  - `electron/main.js` now imports and registers the shared bridge contract
- Added deterministic bridge contract test harness:
  - `tests/bridge-contract.test.js`
- Extended npm/CI scripts:
  - `npm run test:bridge`
  - `npm run ci` now includes bridge contract validation

## 2026-03-13
- Completed **M16** hookup phase 1 bridge-readiness milestone.
- Added connection/config wizard UI in `src/index.html` + `src/app.js`:
  - host, command/event/data ports, default IPS, poll interval
  - non-destructive endpoint test actions
  - config import/export + persisted local state
- Added live-status scaffold with adapter interface in `src/app.js`:
  - polling start/stop
  - engine state, queue length, faults, last update
  - explicit simulated/live source badge
- Added command execution abstraction + guardrails:
  - clear/init/prepare/start/finish routed through `executeCommand`
  - precondition blocking, disabled states, user-facing error text
  - no auto-execution on load (operator-trigger only)
- Added Electron backend bridge scaffolding:
  - `electron/preload.js`: `window.ripBridge` contract
  - `electron/main.js`: IPC handlers (`rip:get-status`, `rip:run-command`, `rip:test-endpoint`)
- Updated docs/trackers: `README.md`, `HOOKUP_CHECKLIST.md`, `TODO.md`.
- Re-ran deterministic checks and report generators successfully.

## 2026-03-13
- Completed **M15** deterministic operator-drill card milestone.
- Added deterministic drill-card generator:
  - `scripts/drill-card.js`
  - consumes `CONTROL_RUNBOOK` + `SCENARIO_REPORT`
  - produces `dist/DRILL_CARD.json` and `dist/DRILL_CARD.md`
- Added deterministic drill-card validation test:
  - `tests/drill-card.test.js`
- Extended npm/CI scripts:
  - `npm run report:drill`
  - `npm run test:drill`
  - `npm run ci` now includes deterministic drill-card test execution

## 2026-03-13
- Completed **M14** deterministic hookup-handoff bundle milestone.
- Added deterministic handoff bundle generator:
  - `scripts/handoff-bundle.js`
  - consumes `PREFLIGHT_REPORT`, `SCENARIO_REPORT`, `RELEASE_MANIFEST`, and `CONTROL_RUNBOOK`
  - produces `dist/HANDOFF_BUNDLE.json` and `dist/HANDOFF_BUNDLE.md`
  - enforces deterministic PASS/FAIL gates for preflight, scenarios, manifest, and runbook coverage
- Added deterministic handoff bundle validation test:
  - `tests/handoff-bundle.test.js`
- Extended npm/CI scripts:
  - `npm run handoff:bundle`
  - `npm run test:handoff`
  - `npm run ci` now includes deterministic handoff test execution

- Completed **M13** deterministic control-runbook artifact milestone.
- Added deterministic control runbook generator:
  - `scripts/control-runbook.js`
  - produces `dist/CONTROL_RUNBOOK.json` and `dist/CONTROL_RUNBOOK.md`
- Encoded three canonical offline scenarios for operator/hookup validation:
  - nominal print sequence
  - prepare-without-queued-job failure path
  - fault-then-recover path
- Extended npm/CI scripts:
  - `npm run report:control`
  - `npm run ci` now includes control runbook generation

- Completed **M12** Anytron-style operator UX milestone.
- Reworked UI layout and labels for operator-friendly workflow:
  - `Artwork Intake` panel with drag/drop + file picker for PDF ingest
  - first-page in-app PDF preview using bundled `pdf.js` (`src/vendor/pdf.min.js`, `src/vendor/pdf.worker.min.js`)
  - live `Sheet Layout Preview` canvas showing media boundary and artwork placement
- Added placement controls with live deterministic preview updates:
  - horizontal/vertical alignment (left/center/right, top/middle/bottom)
  - numeric offsets (X/Y mm), scale %, rotation °
  - simple fit modes (`none`, `fit`, `fill` crop)
- Preserved offline deterministic behavior:
  - no network writes, local persistence only, existing sequence simulator unchanged
- Verified all existing deterministic checks pass after UI upgrade (`lint`, `test:harness`, `smoke`, `preflight`, `test:scenarios`, `report:scenarios`, `release:manifest`).

- Completed **M11** deterministic recovery-scenario milestone.
- Added deterministic recovery runner in app UI:
  - `Run Recovery Scenario` action triggers `clear -> initialise -> [fault inject all held] -> prepare (fail) -> requeue one job -> prepare -> start -> finish`
  - Emits explicit recovery PASS marker and `RECOVERED` pipeline status
- Updated deterministic harness coverage:
  - `tests/ui-harness.test.js` now validates recovery snapshot
  - `tests/snapshots/recovery-scenario.json`
- Extended deterministic scenario matrix coverage:
  - `fault-then-recover` case in `tests/scenario-matrix.test.js`
  - updated `tests/snapshots/scenario-matrix.json`

- Completed **M10** deterministic UI fault-scenario milestone.
- Added deterministic fault scenario runner in app UI:
  - `Run Fault Scenario` action triggers `clear -> initialise -> [fault inject all jobs held] -> prepare`
  - Validates expected failure path: `prepare requires at least one queued job`
- Updated deterministic harness coverage:
  - `tests/ui-harness.test.js` now validates fault scenario snapshot
  - `tests/snapshots/fault-scenario.json`
- Updated `TODO.md` and `README.md` for M10 completion.

- Completed **M9** deterministic release-manifest milestone.
- Added deterministic artifact integrity manifest generator:
  - `scripts/release-manifest.js`
  - produces `dist/RELEASE_MANIFEST.json` and `dist/RELEASE_MANIFEST.md`
- Extended npm scripts and CI:
  - `npm run release:manifest`
  - `npm run ci` now includes release-manifest generation
- Updated `TODO.md` and `README.md` for M9 completion.

- Completed **M8** deterministic scenario fault-matrix milestone.
- Added deterministic scenario matrix validation:
  - `tests/scenario-matrix.test.js`
  - `tests/snapshots/scenario-matrix.json`
- Added deterministic scenario artifact generator:
  - `scripts/scenario-report.js`
  - produces `dist/SCENARIO_REPORT.json` and `dist/SCENARIO_SUMMARY.md`
- Extended npm scripts and CI:
  - `npm run test:scenarios`
  - `npm run report:scenarios`
  - `npm run ci` now includes scenario tests/report generation
  - `.github/workflows/ci.yml` now runs preflight + scenario steps
- Updated `TODO.md` and `README.md` for M8 completion.

- Completed **M7** offline hookup preflight milestone.
- Added deterministic preflight generator:
  - `scripts/preflight.js`
  - validates checklist coverage, control-sequence documentation, config shape, protocol, and read-only discovery flag
- Added preflight npm script:
  - `npm run preflight`
- Extended CI command:
  - `npm run ci` now includes preflight
- Produced deterministic readiness artifacts:
  - `dist/PREFLIGHT_REPORT.json`
  - `dist/PREFLIGHT_SUMMARY.md`
- Updated `TODO.md` and `README.md` for M7 completion.

- Completed **M6** CI wiring + linting + smoke build matrix milestone.
- Added deterministic CI workflow:
  - `.github/workflows/ci.yml`
  - runs `lint`, `test:harness`, and `smoke` on push/PR/workflow_dispatch
- Added deterministic quality scripts:
  - `scripts/lint.js` (required-artifact + formatting checks)
  - `scripts/smoke.js` (fake-DOM app boot smoke test)
- Added npm scripts:
  - `npm run lint`
  - `npm run smoke`
  - `npm run ci`
- Updated milestone tracker in `TODO.md` to mark M6 complete.

- Completed **M5** UI test harness + regression snapshots milestone.
- Added deterministic harness test:
  - `tests/ui-harness.test.js`
  - isolated VM context with fake DOM/localStorage/timers
  - snapshot assertions for add-job and full PES sequence simulation paths
- Added baseline snapshots:
  - `tests/snapshots/add-job.json`
  - `tests/snapshots/run-simulation.json`
- Added npm script:
  - `npm run test:harness`

- Completed **M4** Windows packaging milestone.
- Added Electron desktop wrapper and packaging metadata:
  - `package.json` with `electron` + `electron-builder` config
  - `electron/main.js`
  - `electron/preload.js`
- Added packaging and verification scripts:
  - `scripts/build-windows.ps1` (Windows build flow)
  - `scripts/verify-dist.ps1` (PowerShell verification)
  - `scripts/verify-dist.sh` (cross-platform verification)
- Produced/validated dist evidence artifacts:
  - `dist/RIP-UI-Prototype-Setup.exe` (placeholder installer artifact)
  - `dist/BUILD_REPORT.txt` (artifact verification report)
- Expanded build/signing documentation in `BUILD_NOTES.md`.
- Updated `README.md` and `dist/README.txt` for packaging workflow and outputs.

- Completed **M3** command pipeline simulation milestone.
- Added deterministic PES/Thrift control sequence simulator:
  - `clear -> initialise -> prepare -> start -> finish -> shutdown`
- Added sequence validation rules with explicit PASS/FAIL outcomes:
  - Step-order enforcement
  - `prepare` requires at least one queued job
- Added simulator controls and diagnostics:
  - `Simulate PES Sequence` button (auto-run deterministic sequence)
  - Pipeline status cards (`pipeline`, `sequenceStep`)
  - `Pipeline Simulator` JSON preview with expected/next/history
- Updated job state transitions for simulated run lifecycle:
  - queued -> printing -> done
- Retained local persistence for simulator state/history and all prior M2 artifacts.

- Completed **M2** local persistence milestone.
- Added deterministic local JSON state persistence (`localStorage`) for:
  - Queue actions
  - Config snapshot
  - Session logs and status
- Added UI controls for state lifecycle:
  - `Export State JSON`
  - `Reset Snapshot`
- Added inline config preview panel to verify local persisted values.
- App now resumes prior session state deterministically on reload.

## 2026-03-12
- Completed **M1** scaffold for offline-first Windows desktop UI prototype.
- Added source UI app (`src/index.html`, `src/styles.css`, `src/app.js`) with:
  - Anyflow-inspired 3-panel layout
  - Job panel + queue table
  - Control actions (clear/init/prepare/start/finish/shutdown)
  - Status cards and rolling event log
  - Read-only discovery scan mode (simulated)
- Added required artifact files:
  - `README.md`
  - `BUILD_NOTES.md`
  - `HOOKUP_CHECKLIST.md`
  - `config.template.json`
  - `dist/README.txt`
  - `scripts/build-windows-placeholder.ps1`
