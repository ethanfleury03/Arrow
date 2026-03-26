# Windows Deployment (Self-Contained Runtime)

Goal: make RIP bridge bring-up deterministic on any Windows machine.

## 1) Required runtime artifacts

Keep runtime dependencies inside repo path conventions:

- `runtime/bin/gborcat.exe` (preferred canonical location)
- `bridge/server.js`
- `scripts/start-bridge.cmd`
- `scripts/verify-runtime.cmd`

If `gborcat.exe` cannot be redistributed for licensing reasons, keep it on host and set `MEMJET_GBORCAT_BIN` explicitly before launch.

## 2) One-command bridge start

From `C:\Arrow\rip-ui`:

```cmd
scripts\start-bridge.cmd
```

The launcher sets safe defaults for Arrow target and verifies runtime before start.

## 3) Canonical environment defaults

- `MEMJET_REAL_BACKEND=ssh`
- `MEMJET_TARGET_HOST=192.168.100.200`
- `MEMJET_TARGET_COMMAND_PORT=13001`
- `MEMJET_TARGET_EVENT_PORT=9231`
- `MEMJET_TARGET_DATA_PORT=13001`
- `RIP_BRIDGE_ENABLE_REAL_COMMANDS=true`
- `RIP_BRIDGE_ENABLE_REAL_START_PRINT=true`
- `RIP_BRIDGE_REAL_DRY_RUN=false`
- `MEMJET_ALLOW_DATA_SUBMISSION=true`

## 4) Print smoke test (API)

```cmd
curl -s -X POST http://127.0.0.1:8787/api/jobs/ingest -H "content-type: application/json" -d "{\"filePath\":\"C:\\Users\\Arrow\\Downloads\\Apple.pdf\",\"copies\":1}"
```

Then:

```cmd
curl -s -X POST http://127.0.0.1:8787/api/jobs/<JOB_ID>/send -H "content-type: application/json" -d "{\"copies\":1}"
```

## 5) Common failures

- `unsupported_op submitJobData` in SSH mode:
  - remote `pesctl` lacks submit op; bridge falls back to local gborcat.
- `fallback gborcat failed (ENOENT)`:
  - `gborcat.exe` missing from PATH and `MEMJET_GBORCAT_BIN` not set.
- `Invalid method name: getStatus`:
  - wrong command port (usually drift to `13002`); Arrow uses `13001`.
- `Job <id> not found`:
  - bridge restarted; job store is in-memory. Re-ingest and send.
