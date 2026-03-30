# Rollback Procedure

Use this checklist when reverting a deployment to the previous known-good state.

## Prerequisites

- Git access to the Arrow repository
- SSH access to the deployment host (or physical access for air-gapped setups)
- Know the target rollback commit hash (check `git log --oneline -10`)

## Steps

### 1. Stop Running Services

```bash
# On the deployment host
# Stop the Electron app (if running)
taskkill /IM "RIP UI Prototype.exe" /F   # Windows
# or kill the electron process on Linux/macOS

# Stop the bridge server (if running standalone)
# The bridge handles SIGINT/SIGTERM gracefully — it drains in-flight requests,
# closes SSE connections, and flushes the SQLite DB before exiting.
kill -SIGTERM <bridge-pid>
```

### 2. Revert Code

```bash
git checkout <previous-known-good-commit>
# or revert a specific commit
git revert <bad-commit-hash>
```

### 3. Reinstall Dependencies

```bash
cd rip-ui && npm ci
cd ../rip-core && pip install -r requirements.txt
```

### 4. Verify Tests Pass

```bash
cd rip-ui && npm test
cd ../rip-core && python -m pytest adapter/tests/ -v
```

### 5. Restart Services

```bash
# Bridge
cd rip-ui && node bridge/server.js

# Electron UI
cd rip-ui && npm start
```

### 6. Smoke Test

After rollback, verify core functionality:

- [ ] Bridge health endpoint responds: `curl http://127.0.0.1:8787/api/health`
- [ ] Device status endpoint responds: `curl http://127.0.0.1:8787/api/device/status`
- [ ] Ingest a known-good PDF and confirm job creation
- [ ] Send a test print and confirm no auth/env errors in logs
- [ ] Check that SSE status stream reconnects

### 7. Preserve Evidence

```bash
# Save the bridge logs before and after rollback
cp rip-ui/logs/bridge-*.log /tmp/rollback-evidence/

# Note the git state
git log --oneline -5 > /tmp/rollback-evidence/git-state.txt
```

## Database Considerations

The SQLite database (`rip-ui/bridge-data/rip.db`) uses forward-only migrations.
If a new migration was applied that the rolled-back code doesn't know about,
the older code will still work — it simply won't read the new columns/tables.

If a migration is destructive (rare), you may need to restore the database
from backup:

```bash
cp bridge-data/rip.db.bak bridge-data/rip.db
```

## Environment Variable Checklist

After rollback, confirm these are still set on the runtime host:

| Variable | Required | Purpose |
|----------|----------|---------|
| `MEMJET_SSH_USER` | Yes (SSH backend) | SSH username for PES host |
| `MEMJET_SSH_PASSWORD` | Yes (SSH backend) | SSH password for PES host |
| `ARROW_PES_SSH_HOST_KEY` | Optional | Ed25519 host key fingerprint |
| `ARROW_PES_HOST` | Optional | PES IP (default: 192.168.111.1) |
| `RIP_BRIDGE_PORT` | Optional | Bridge HTTP port (default: 8787) |
