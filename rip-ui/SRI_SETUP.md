# Sri's Setup Guide — DuraFlex / Candien Office

## What this is
RIP UI Prototype — the operator console app for DuraFlex RIP+PES workflows.
The unit tests (`npm run test:app`) run on any platform and are a good first check.

---

## 1. Clone the repo

```bash
git clone https://github.com/ethanfleury03/Arrow.git
cd Arrow/rip-ui
```

> Uses HTTPS — no SSH keys needed.

---

## 2. Install Node.js

**Required: Node 18 or higher**

Check what you have:
```bash
node --version
```

If it's below 18 or not installed:
- **Windows:** Download from https://nodejs.org (use LTS version)
- Or use [nvm-windows](https://github.com/coreybutler/nvm-windows)

**Recommended: Node 20 LTS** — what we use locally.

---

## 3. Install dependencies

```bash
npm install
```

> Note: `better-sqlite3` and `thrift` are native modules and may require
> Microsoft Visual Studio Build Tools on Windows. If `npm install` errors out
> on those, the unit tests can still run — see step 5.

If you hit build errors on Windows with native modules:
```bash
npm install --ignore-scripts   # skip compiling native addons
npm install --build-from-source=false 2>/dev/null  # use prebuilt if available
```

---

## 4. Run the unit tests

```bash
npm run test:app     # 38 passing tests (app.js logic)
npm run test:board   # 25 passing tests (board composition)
```

These use jsdom — no browser or Electron needed. Should work on Mac, Windows, or Linux.

---

## 5. If npm install fails on native modules

The unit tests don't actually use `better-sqlite3`, `thrift`, or `three` — they only
test `app.js` logic via jsdom. You can run them directly:

```bash
npm install --ignore-scripts   # installs JS deps only
node --require ./tests/unit/jsdom.setup.js tests/unit/app.test.js
```

If the above still fails with a module not found error, install jsdom explicitly:

```bash
npm install jsdom --save-dev --ignore-scripts
npm run test:app
```

---

## 6. For the full Electron app

The app itself is Windows/Electron and talks to DuraFlex hardware — that requires
more setup (thrift bridge, rip-core backend, etc.) and is specific to the
DuraFlex machine. That's a separate conversation.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node: command not found` | Install Node.js 20 LTS |
| `npm install` fails on `better-sqlite3` | `npm install --ignore-scripts` |
| `npm run test:app` — module not found | `npm install jsdom --save-dev --ignore-scripts` |
| Tests hang or timeout | Normal — some tests wait for timeouts, ~30s total |

---

## Repo structure

```
Arrow/
├── rip-ui/              ← main app (this repo)
│   ├── src/app.js       ← the main app logic
│   ├── tests/unit/      ← unit tests
│   └── .github/workflows/test.yml  ← CI config
└── rip-core/           ← backend + hardware bridge
```
