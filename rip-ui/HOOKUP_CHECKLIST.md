# HOOKUP CHECKLIST (Phase 4: Live hookup safety + scaffold)

- [ ] Choose an operator profile (`RIP_OPERATOR_PROFILE=simulator-safe|kareela-lab`).
- [ ] Optional: set `RIP_UI_CONFIG_FILE` to load profile overrides from JSON.
- [ ] For live command-plane set:
  - [ ] `RIP_BACKEND_MODE=thrift-cli`
  - [ ] `RIP_THRIFT_BRIDGE_BIN=/absolute/path/to/thrift-bridge`
- [ ] Set `RIP_DATA_SUBMITTER_BIN` for data-plane handoff.
  - [ ] Recommended baseline: `scripts/production-data-submitter.js` (deterministic dry-run bundle output).
  - [ ] Confirm adapter matches `docs/DATA_SUBMITTER_CONTRACT.md` request/response schema.
  - [ ] Optional live command execution only when explicitly ready: `RIP_SUBMIT_EXECUTE=1` (+ `RIP_GBORCAT_BIN` if needed).
  - [ ] For offline deterministic checks, `scripts/mock-data-submitter.js` remains supported.
- [ ] Start Electron and verify mode badge shows profile + backend + host/command port.
- [ ] Run endpoint probes (command/event/data) and confirm all are `OK`.
- [ ] Start status polling.
- [ ] Load PDF artwork.
- [ ] Run **Preflight** and confirm `passed=true` before `start` command.
- [ ] Verify mutating commands still require explicit operator confirmation.
- [ ] Verify documented operator sequence: clear -> initialise -> prepare -> start -> finish -> shutdown.
- [ ] Verify `start` remains blocked if preflight has not passed.
- [ ] Trigger **Submit Data-plane Job** and verify explicit result (`SUBMITTED` or clear not-configured rejection).
- [ ] Verify operator audit entries are written (UI panel + Electron audit file append).
- [ ] Verify no auto-executed commands on boot and no fake live submission success.

## Deterministic evidence mapping
- `npm run test:bridge`
- `npm run test:backend`
- `npm run test:runtime-config`
- `npm run test:hookup`
- `npm run test:submitter:prod`
- `npm run test:submitter:report`
- `npm run report:submitter`
- `npm run report:hookup`
