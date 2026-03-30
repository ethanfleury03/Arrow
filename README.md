# Arrow RIP

Raster Image Processor for Duraflex/Memjet print engines. Converts PDF artwork to printer-ready data and manages the full print lifecycle (ingest, RIP, data transfer, engine control).

## Repository Layout

```
Arrow/
├── rip-ui/          Electron desktop operator console + HTTP bridge
│   ├── bridge/      Node.js HTTP bridge server (connects UI ↔ PES)
│   ├── electron/    Electron main process + runtime config
│   ├── src/         Renderer (single-page operator UI)
│   ├── scripts/     Build, deploy, and diagnostic scripts
│   └── tests/       Unit and integration tests
├── rip-core/        C++ RIP engine + Python adapter service
│   ├── src/         C++ source (memjet-rip, direct_tcp_sender, etc.)
│   ├── adapter/     FastAPI adapter service wrapping the C++ binary
│   ├── jsl-sdk/     JSL SDK configuration
│   └── vendor/      Third-party Python bindings (Thrift/Memjet)
```

## Quick Start

### Prerequisites

| Component | Requirement |
|-----------|------------|
| Node.js   | ≥ 18 LTS  |
| Python    | ≥ 3.12     |
| C++ build | CMake + platform toolchain (Windows: MSVC) |

### Install and Test

```bash
# rip-ui
cd rip-ui
npm ci
npm test            # runs full CI test suite

# rip-core adapter
cd rip-core
pip install -r requirements.txt
python -m pytest adapter/tests/ -v
```

### Run the Bridge

```bash
cd rip-ui
node bridge/server.js
# Listens on http://127.0.0.1:8787 by default
```

### Run the Electron UI

```bash
cd rip-ui
npm start
```

## Network Defaults (PES Connection)

All components share a single source of truth for PES connection defaults
(`rip-ui/bridge/pes-defaults.js`):

| Parameter    | Default          | Env Override (primary)           |
|-------------|------------------|----------------------------------|
| Host        | `192.168.111.1`  | `ARROW_PES_HOST`                 |
| Command Port| `13001`          | `ARROW_PES_COMMAND_PORT`         |
| Event Port  | `9231`           | `ARROW_PES_EVENT_PORT`           |
| Data Port   | `13001`          | `ARROW_PES_DATA_PORT`            |

Legacy `MEMJET_TARGET_*` and `MEMJET_*` env vars are still respected as fallbacks.

### Required Environment Variables (Production)

```bash
MEMJET_SSH_USER=<ssh-user>
MEMJET_SSH_PASSWORD=<ssh-password>
ARROW_PES_SSH_HOST_KEY=<optional-host-key-fingerprint>
```

## Rollback Procedure

See [docs/ROLLBACK.md](docs/ROLLBACK.md) for the step-by-step rollback checklist.

## CI

GitHub Actions runs on every push:
- **rip-ui**: `npm run ci` (lint, smoke, unit tests, integration tests)
- **rip-core**: `pytest adapter/tests/ -v`
