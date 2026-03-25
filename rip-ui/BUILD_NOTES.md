# BUILD_NOTES

## Milestone M4 (Windows packaging flow)

Added Electron desktop wrapper and packaging config:
- `package.json` with `electron` + `electron-builder`
- `electron/main.js` + `electron/preload.js`
- `scripts/build-windows.ps1` for Windows packaging flow
- `scripts/verify-dist.ps1` (Windows) and `scripts/verify-dist.sh` (cross-platform)

## Build commands

### Windows real package build
```powershell
./scripts/build-windows.ps1
```
This installs dependencies (if needed), runs `electron-builder`, and verifies dist output.

### Placeholder build (deterministic fallback)
```powershell
./scripts/build-windows-placeholder.ps1
```
Generates `dist/RIP-UI-Prototype-Setup.exe` placeholder payload.

### Dist verification
```bash
./scripts/verify-dist.sh
```
or on Windows:
```powershell
./scripts/verify-dist.ps1
```

Verification writes `dist/BUILD_REPORT.txt`.

## Data-plane adapter binaries (M37)

- Contract reference: `docs/DATA_SUBMITTER_CONTRACT.md`
- Deterministic mock binary: `scripts/mock-data-submitter.js`
- Production submitter scaffold: `scripts/production-data-submitter.js`
  - Default `dry-run` mode writes deterministic spool bundle under `dist/spool/<jobId>/`
  - Optional live execution only when `RIP_SUBMIT_EXECUTE=1`
- Contract checks:
```bash
npm run test:submitter
npm run test:submitter:prod
npm run test:submitter:report
npm run report:submitter
```

## Signed installer notes

For production signing, set these on the Windows build host:
- `CSC_LINK` (path or URL to code-sign cert)
- `CSC_KEY_PASSWORD` (certificate password)

Recommended process:
1. Build unsigned in CI smoke stage.
2. Sign in controlled release stage only.
3. Archive installer + `BUILD_REPORT.txt` + checksum in release evidence.
4. Validate SmartScreen reputation over repeated signed releases.
