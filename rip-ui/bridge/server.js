const http = require('node:http');
const { URL } = require('node:url');
const fs = require('node:fs');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const execFileAsync = promisify(execFile);
const { loadBridgeConfig } = require('./config');
const { createLogger } = require('./logger');
const { createMemjetAdapter, AdapterCapabilityError } = require('./memjet-adapter');
const { JobManager } = require('./job-manager');
const { Client: SshClient } = require('ssh2');
const {
  ENGINE_STATE_VALUE_TO_NAME,
  ENGINE_STATE_NAME_TO_UI,
  parseEngineStateNumberFromRaw,
  extractEmbeddedJsonRawFromOutput,
  hasSimulatedSignal,
  resolveEngineState
} = require('./engine-state');
const { buildSshSettings, buildSshArgs, runSshSelfCheck } = require('./real-client-factory.local');
const { loadPesDefaults } = require('./pes-defaults');

function json(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const MAX_BODY_BYTES = Number(process.env.RIP_BRIDGE_MAX_BODY_BYTES) || 10 * 1024 * 1024;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error(`Request body exceeds ${MAX_BODY_BYTES} byte limit`));
        return;
      }
      buf += String(chunk);
    });
    req.on('end', () => {
      if (!buf.trim()) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const DEFAULT_PRINT_UNITS = Object.freeze([]);

const COMMAND_HANDLERS = {
  clean_light: adapter => adapter.startServicing({ level: 'light' }),
  clean_medium: adapter => adapter.startServicing({ level: 'medium' }),
  clean_heavy: adapter => adapter.startServicing({ level: 'heavy' }),
  prime_begin: adapter => adapter.startPriming({}),
  deprime_begin: adapter => adapter.startDepriming({}),
  engine_initialise: adapter => adapter.initialiseEngine({}),
  engine_shutdown: adapter => adapter.shutdownEngine({}),
  engine_replace_wipers: adapter => adapter.replaceWipers({}),
  head_cap: adapter => adapter.startMovingPrintheads({ printUnits: DEFAULT_PRINT_UNITS, position: 'capped' }),
  head_raise: adapter => adapter.startMovingPrintheads({ printUnits: DEFAULT_PRINT_UNITS, position: 'raised' }),
  head_print: adapter => adapter.startMovingPrintheads({ printUnits: DEFAULT_PRINT_UNITS, position: 'print' }),
  print_finish: adapter => adapter.finishPrinting({})
};

const COMMAND_LOG_META = {
  head_cap: { memjetMethod: 'startMovingPrintheads', args: [{ printUnits: DEFAULT_PRINT_UNITS, position: 'capped' }] },
  head_raise: { memjetMethod: 'startMovingPrintheads', args: [{ printUnits: DEFAULT_PRINT_UNITS, position: 'raised' }] },
  head_print: { memjetMethod: 'startMovingPrintheads', args: [{ printUnits: DEFAULT_PRINT_UNITS, position: 'print' }] }
};

function classifyCommandRuntimeError(error, command) {
  const msg = String(error?.message || 'unknown_error');
  const lower = msg.toLowerCase();
  const isHeadCommand = String(command || '').startsWith('head_');

  if (isHeadCommand && lower.includes('importerror') && lower.includes('printheadposition')) {
    return {
      status: 409,
      payload: {
        accepted: false,
        error: 'runtime_mismatch',
        command,
        message: 'Printhead controls unavailable: remote PES runtime is missing PrintheadPosition enum compatibility.',
        remediation: 'Update remote pesctl/memjet bridge runtime to a version that supports startMovingPrintheads position enums (capped/raised/print).',
        source: 'bridge-http',
        timestamp: new Date().toISOString(),
        details: {
          code: 'PRINTHEAD_RUNTIME_MISMATCH',
          rawError: msg.slice(0, 4000)
        }
      }
    };
  }

  return null;
}


function firstDefinedString(...values) {
  for (const value of values) {
    const str = String(value || '').trim();
    if (str) return str;
  }
  return '';
}



function extractInkLevels(status = {}) {
  const details = status?.details || {};
  const output = String(details?.productInfo?.output || '');
  if (!output) return { C: 0, M: 0, Y: 0, K: 0 };

  const byColor = {};
  const tankRegex = /InkTankStatus\(([^)]*)\)/g;
  let match;
  while ((match = tankRegex.exec(output)) !== null) {
    const chunk = match[1] || '';
    const cap = Number((/inkCapacity\s*=\s*([0-9.]+)/i.exec(chunk) || [])[1]);
    const rem = Number((/inkRemaining\s*=\s*([0-9.]+)/i.exec(chunk) || [])[1]);
    const color = Number((/color\s*=\s*(\d+)/i.exec(chunk) || [])[1]);
    if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(rem) || !Number.isInteger(color)) continue;
    byColor[color] = Math.max(0, Math.min(100, Math.round((rem / cap) * 100)));
  }

  return {
    C: Number.isFinite(byColor[1]) ? byColor[1] : 0,
    M: Number.isFinite(byColor[2]) ? byColor[2] : 0,
    Y: Number.isFinite(byColor[3]) ? byColor[3] : 0,
    K: Number.isFinite(byColor[4]) ? byColor[4] : 0
  };
}

async function performStartupSelfCheck({ config, logger, skipIfLocal = false }) {
  // Only run self-check for SSH backend
  const backend = String(process.env.MEMJET_REAL_BACKEND || 'ssh').trim().toLowerCase();
  if (skipIfLocal && backend === 'local') {
    logger.info({ msg: 'bridge.selfCheck.skipped', reason: 'local_backend' });
    return { ok: true, skipped: true };
  }

  // Check if SSH is configured — fall back to pes-defaults.js hardcoded values
  const ARROW_PES = loadPesDefaults();
  const sshHost = String(process.env.MEMJET_SSH_HOST || process.env.RIP_SSH_HOST || ARROW_PES.sshHost || '').trim();
  const sshUser = String(process.env.MEMJET_SSH_USER || process.env.RIP_SSH_USER || ARROW_PES.sshUser || '').trim();
  const cmdTemplate = String(process.env.MEMJET_SSH_REMOTE_CMD_TEMPLATE || ARROW_PES.sshRemoteCmdTemplate || '').trim();

  if (!sshHost || !sshUser || !cmdTemplate) {
    const missing = [
      !sshHost ? 'MEMJET_SSH_HOST' : null,
      !sshUser ? 'MEMJET_SSH_USER' : null,
      !cmdTemplate ? 'MEMJET_SSH_REMOTE_CMD_TEMPLATE' : null
    ].filter(Boolean);
    const reason = `SSH not fully configured (missing: ${missing.join(', ')}) - skipping self-check`;
    logger.info({ msg: 'bridge.selfCheck.skipped', reason, missing });
    return { ok: true, skipped: true, reason };
  }

  logger.info({ msg: 'bridge.selfCheck.start', backend, sshHost, sshUser });

  const settings = buildSshSettings({
    host: config?.memjet?.host,
    commandPort: config?.memjet?.commandPort,
    eventPort: config?.memjet?.eventPort,
    dataPort: config?.memjet?.dataPort
  });

  const result = await runSshSelfCheck(settings, logger);

  if (!result.ok) {
    logger.error({
      msg: 'bridge.selfCheck.failed',
      category: result.category,
      reason: result.reason,
      sshHost: settings.sshHost,
      sshUser: settings.sshUser
    });

    // Return detailed error for caller to handle
    return {
      ok: false,
      category: result.category,
      reason: result.reason,
      error: result.error
    };
  }

  logger.info({ msg: 'bridge.selfCheck.ok' });
  return { ok: true };
}

function createBridgeServer(options = {}) {
  const config = options.config || loadBridgeConfig(process.env);
  const logger = options.logger || createLogger({ level: config.logLevel });
  const subscribers = new Set();
  const statusSubscribers = new Set();
  const adapter = options.adapter || createMemjetAdapter({ logger, config: config.memjet });
  const manager = new JobManager({
    adapter,
    logger,
    dataDir: config.dataDir,
    emit: (type, payload) => {
      const evt = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
      subscribers.forEach(res => res.write(evt));
    }
  });

  // Get store reference for logging
  const store = manager.getStore();

  // Wrap logger to also write to audit_log
  const originalInfo = logger.info.bind(logger);
  const originalError = logger.error.bind(logger);
  const originalWarn = logger.warn.bind(logger);
  const originalDebug = logger.debug.bind(logger);

  logger.info = (payload) => {
    originalInfo(payload);
    try {
      if (store && payload.msg) {
        store.appendAudit('info', payload.msg, { ...payload, msg: undefined });
      }
    } catch {}
  };

  logger.error = (payload) => {
    originalError(payload);
    try {
      if (store && payload.msg) {
        store.appendAudit('error', payload.msg, { ...payload, msg: undefined });
      }
    } catch {}
  };

  logger.warn = (payload) => {
    originalWarn(payload);
    try {
      if (store && payload.msg) {
        store.appendAudit('warn', payload.msg, { ...payload, msg: undefined });
      }
    } catch {}
  };

  logger.debug = (payload) => {
    originalDebug(payload);
    try {
      if (store && payload.msg) {
        store.appendAudit('debug', payload.msg, { ...payload, msg: undefined });
      }
    } catch {}
  };

  let statusPollTimer = null;
  let statusPollInFlight = false;
  let statusPollPromise = null;
  let lastStatusSignature = '';
  let latestRawDeviceStatus = null;
  let latestSystemState = {
    engineState: 'UNKNOWN',
    engineStateRawNumeric: null,
    engineStateRawLabel: 'UNKNOWN',
    engineStateCanonical: 'UNKNOWN',
    queueLength: 0,
    connected: false,
    degraded: true,
    source: 'bridge-http',
    timestamp: new Date().toISOString()
  };

  // ── Reboot state — single source of truth for the UI ────────────────────────
  // null | 'rebooting' | 'polling' | 'initialising'
  // SHUTTING_DOWN etc. come from live printhead status only (no synthetic rebootState).
  // Injected into every SSE emission so the UI never has to guess.
  let rebootState = null;

  function setRebootState(next) {
    rebootState = next;
    // Push immediately — don't wait for the next poll tick
    emitSystemState(latestSystemState);
    process.stderr.write('[REBOOT] rebootState → ' + (next || 'null') + '\n');
    logger.info({ msg: 'bridge.system.reboot.state_change', rebootState: next });
  }
  // ────────────────────────────────────────────────────────────────────────────

  // ── Reboot recovery watcher ─────────────────────────────────────────────────
  let rebootWatcherActive = false;

  function startRebootWatcher({ sshBin, sshHost, sshUser, sshKeyPath, sshPort }) {
    if (rebootWatcherActive) {
      logger.warn({ msg: 'bridge.system.reboot.watcher_already_active', host: sshHost });
      return;
    }
    rebootWatcherActive = true;

    const SAFETY_HOLD_MS = 120000;
    const SSH_POLL_INTERVAL_MS = 3000;
    const MAX_SSH_ATTEMPTS = 60; // 3 more minutes after the hold
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    let sshAttempts = 0;

    // rebootState is already set to 'rebooting' by the HTTP handler — just log the hold
    const resumeAt = new Date(Date.now() + SAFETY_HOLD_MS).toISOString();
    process.stderr.write('\n[REBOOT] 2min safety hold — polling starts at ' + resumeAt + '\n');
    logger.info({ msg: 'bridge.system.reboot.hold_start', host: sshHost, resumeAt });

    setTimeout(startPolling, SAFETY_HOLD_MS);

    function startPolling() {
      // Phase 2 — SSH ping loop
      setRebootState('polling');
      process.stderr.write('[REBOOT] 60s elapsed — polling SSH every 3s for ' + sshHost + '\n');
      logger.info({ msg: 'bridge.system.reboot.polling_start', host: sshHost });
      setTimeout(tryPing, SSH_POLL_INTERVAL_MS);
    }

    async function tryPing() {
      if (!rebootWatcherActive) return;

      if (sshAttempts >= MAX_SSH_ATTEMPTS) {
        rebootWatcherActive = false;
        setRebootState(null);
        process.stderr.write('\n[REBOOT] Timed out — ' + sshHost + ' did not respond within 3min after hold\n\n');
        logger.error({ msg: 'bridge.system.reboot.watch_timeout', host: sshHost, sshAttempts });
        return;
      }
      sshAttempts++;

      const pingArgs = [
        '-F', nullDevice,
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'IdentitiesOnly=yes',
        '-o', 'PreferredAuthentications=publickey',
        '-o', 'ConnectTimeout=5',
        '-p', String(sshPort || 22),
        ...(sshKeyPath ? ['-i', sshKeyPath] : []),
        sshUser + '@' + sshHost,
        'echo rip_ping_ok'
      ];

      // SSH ping
      try {
        await execFileAsync(sshBin, pingArgs, { timeout: 8000, maxBuffer: 4096 });
      } catch {
        // SSH not up yet — try again
        setTimeout(tryPing, SSH_POLL_INTERVAL_MS);
        return;
      }

      // SSH is up — verify PES is in OFF state before initialising
      process.stderr.write('[REBOOT] SSH up (attempt ' + sshAttempts + ') — checking engineState\n');
      logger.info({ msg: 'bridge.system.reboot.ssh_up', host: sshHost, sshAttempts });

      let engineState = null;
      try {
        const status = await manager.refreshDeviceStatus();
        // resolveEngineState normalises numeric/string labels → canonical name
        const resolved = resolveEngineState(status);
        engineState = String(resolved.rawLabel || resolved.canonical || '').toUpperCase();
        process.stderr.write('[REBOOT] getStatus → engineState=' + (engineState || 'unknown') + '\n');
        logger.info({ msg: 'bridge.system.reboot.status_check', engineState, host: sshHost });
      } catch (statusErr) {
        // PES not answering yet — keep waiting
        process.stderr.write('[REBOOT] getStatus failed (' + statusErr.message + ') — retrying\n');
        setTimeout(tryPing, SSH_POLL_INTERVAL_MS);
        return;
      }

      // States past OFF mean the machine already got initialised (manually or by a
      // previous watcher invocation).  Stop without initialising again.
      const ALREADY_INITIALISED = ['INITIALISING', 'IDLE', 'READY', 'PRIMED_IDLE', 'PRINTING', 'MAINTENANCE'];
      if (ALREADY_INITIALISED.indexOf(engineState) !== -1) {
        rebootWatcherActive = false;
        process.stderr.write('\n[REBOOT] engineState=' + engineState + ' — machine already initialised, watcher done\n\n');
        logger.info({ msg: 'bridge.system.reboot.already_initialised', host: sshHost, engineState });
        setRebootState(null);
        return;
      }

      // Still not OFF and not a known-alive state — PES not ready yet, keep polling
      if (engineState !== 'OFF' && engineState !== '0') {
        process.stderr.write('[REBOOT] engineState=' + engineState + ' (want OFF) — retrying\n');
        setTimeout(tryPing, SSH_POLL_INTERVAL_MS);
        return;
      }

      // Phase 3 — machine confirmed clean and ready
      rebootWatcherActive = false;
      process.stderr.write('\n[REBOOT] engineState=OFF confirmed — sending engine_initialise\n');
      logger.info({ msg: 'bridge.system.reboot.machine_ready', host: sshHost, engineState });

      setRebootState('initialising');

      try {
        await adapter.initialiseEngine({});
        process.stderr.write('[REBOOT] engine_initialise sent OK\n\n');
        logger.info({ msg: 'bridge.system.reboot.initialise_ok', host: sshHost });
      } catch (initErr) {
        process.stderr.write('[REBOOT] engine_initialise failed: ' + initErr.message + '\n\n');
        logger.error({ msg: 'bridge.system.reboot.initialise_error', err: initErr.message, host: sshHost });
      }

      // Phase 4 — done, normal polling resumes
      setRebootState(null);
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  function toSystemStateSnapshot(status = {}) {
    const details = status?.details || {};
    const resolved = resolveEngineState(status);

    if (process.env.RIP_STATUS_DEBUG === '1') {
      logger.info({
        msg: 'bridge.status.map.detail',
        extractedNumeric: resolved.numeric,
        rawEngineState: resolved.rawLabel,
        canonicalEngineState: resolved.canonical,
        mappedEngineState: resolved.engineState,
        extraction: resolved.extraction
      });
    }

    return {
      engineState: resolved.engineState,
      engineStateRawNumeric: resolved.numeric,
      engineStateRawLabel: resolved.rawLabel,
      engineStateCanonical: resolved.canonical,
      queueLength: Number(details?.queueLength || 0),
      inkLevels: extractInkLevels(status),
      connected: Boolean(status?.connected),
      degraded: Boolean(status?.degraded),
      source: 'bridge-http',
      timestamp: status?.lastUpdate || new Date().toISOString()
    };
  }

  function emitSystemState(snapshot, { initial = false } = {}) {
    const payload = {
      ...snapshot,
      rebootState,
      initial,
      emittedAt: new Date().toISOString()
    };
    const evt = `event: system-state\ndata: ${JSON.stringify(payload)}\n\n`;
    statusSubscribers.forEach(res => res.write(evt));
  }

  async function pollSystemState() {
    if (statusPollInFlight) return statusPollPromise;
    statusPollInFlight = true;
    statusPollPromise = _doPoll();
    return statusPollPromise;
  }

  async function _doPoll() {

    try {
      const status = await manager.refreshDeviceStatus();
      latestRawDeviceStatus = status;
      const snapshot = toSystemStateSnapshot(status);
      latestSystemState = snapshot;

      if (process.env.RIP_STATUS_DEBUG === '1') {
        logger.info({
          msg: 'bridge.status.map',
          rawEngine: status?.engine,
          rawProductInfo: status?.details?.productInfo || null,
          mappedEngineState: snapshot.engineState,
          connected: snapshot.connected,
          degraded: snapshot.degraded
        });
      }

      const signature = JSON.stringify({
        engineState: snapshot.engineState,
        engineStateRawNumeric: snapshot.engineStateRawNumeric,
        engineStateRawLabel: snapshot.engineStateRawLabel,
        queueLength: snapshot.queueLength,
        inkLevels: snapshot.inkLevels,
        connected: snapshot.connected,
        degraded: snapshot.degraded,
        rebootState
      });

      if (signature !== lastStatusSignature) {
        lastStatusSignature = signature;
        if (!snapshot.connected) {
          process.stderr.write('\n[STATUS] Device OFFLINE — emitting connected:false to UI\n\n');
          logger.warn({ msg: 'bridge.status.device_offline', engineState: snapshot.engineState, degraded: snapshot.degraded });
        } else if (snapshot.connected) {
          process.stderr.write('\n[STATUS] Device ONLINE — emitting connected:true to UI\n\n');
          logger.info({ msg: 'bridge.status.device_online', engineState: snapshot.engineState });
        }
        emitSystemState(snapshot);

        // Persist device status snapshot to DB (throttled to on-change)
        try {
          if (store) {
            store.recordDeviceStatus({
              engineState: snapshot.engineState,
              engineStateRawNumeric: snapshot.engineStateRawNumeric,
              engineStateRawLabel: snapshot.engineStateRawLabel,
              queueLength: snapshot.queueLength,
              inkLevels: snapshot.inkLevels,
              connected: snapshot.connected,
              degraded: snapshot.degraded,
              details: status?.details || null
            });
          }
        } catch (e) {
          logger.error({ msg: 'bridge.status.snapshot.failed', error: e.message });
        }
      }
    } catch (error) {
      const errorMsg = String(error?.message || error);
      // Classify error into category for better observability
      let errorCategory = 'unknown';
      if (errorMsg.includes('Permission denied') || errorMsg.includes('Authentication failed')) {
        errorCategory = 'ssh_auth_denied';
      } else if (errorMsg.includes('Could not resolve hostname') || errorMsg.includes('Name or service not known')) {
        errorCategory = 'ssh_host_unreachable';
      } else if (errorMsg.includes('Connection refused')) {
        errorCategory = 'ssh_connection_refused';
      } else if (errorMsg.includes('Connection timed out') || errorMsg.includes('timeout')) {
        errorCategory = 'ssh_timeout';
      } else if (errorMsg.includes('config') || errorMsg.includes('SSH')) {
        errorCategory = 'ssh_auth_config';
      } else if (errorMsg.includes('pesctl') || errorMsg.includes('command not found')) {
        errorCategory = 'pesctl_error';
      } else if (errorMsg.includes('non-JSON') || errorMsg.includes('parse')) {
        errorCategory = 'status_parse_error';
      }

      const fallback = {
        engineState: 'UNKNOWN',
        engineStateRawNumeric: null,
        engineStateRawLabel: 'UNKNOWN',
        engineStateCanonical: 'UNKNOWN',
        queueLength: 0,
        inkLevels: { C: 0, M: 0, Y: 0, K: 0 },
        connected: false,
        degraded: true,
        source: 'bridge-http',
        timestamp: new Date().toISOString(),
        error: errorMsg,
        errorCategory
      };

      latestRawDeviceStatus = latestRawDeviceStatus || { connected: false, degraded: true, details: {} };
      latestSystemState = fallback;
      const signature = JSON.stringify({ engineState: fallback.engineState, connected: fallback.connected, degraded: fallback.degraded, error: fallback.error, errorCategory: fallback.errorCategory, rebootState });
      if (signature !== lastStatusSignature) {
        lastStatusSignature = signature;
        emitSystemState(fallback);
      }
      logger.error({ msg: 'bridge.status.poll.error', err: errorMsg, errorCategory });
    } finally {
      statusPollInFlight = false;
    }
  }

  function resolvedEngineUpperFromStatus(status) {
    const resolved = resolveEngineState(status || {});
    return String(resolved.rawLabel || resolved.canonical || '').toUpperCase();
  }

  /** Poll until printhead reports OFF (after engine_shutdown). Live SSE shows SHUTTING_DOWN/OFF from device. */
  async function waitForEngineOff({ deadlineMs = 180000, pollMs = 1000 } = {}) {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() < deadline) {
      await pollSystemState();
      const label = resolvedEngineUpperFromStatus(latestRawDeviceStatus);
      if (label === 'OFF' || label === '0') return true;
      await new Promise(r => setTimeout(r, pollMs));
    }
    return false;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      res.write('event: connected\ndata: {"ok":true}\n\n');
      subscribers.add(res);
      req.on('close', () => subscribers.delete(res));
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/api/device/status/stream') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        });
        res.write('retry: 2000\n\n');
        statusSubscribers.add(res);
        emitSystemState(latestSystemState, { initial: true });
        req.on('close', () => statusSubscribers.delete(res));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { ok: true, service: 'rip-bridge-v1', ts: new Date().toISOString() });
      }

      if (req.method === 'GET' && url.pathname === '/api/device/status') {
        if (!latestRawDeviceStatus) {
          await pollSystemState();
        }

        const raw = latestRawDeviceStatus || {};
        const snapshot = latestSystemState || {};

        const moveHeadOp = raw?.details?.diagnostics?.operations?.startMovingPrintheads || {};

        // Get engine operation capabilities from adapter if available
        let engineOps = {};
        try {
          const diag = await adapter._buildDiagnostics?.();
          if (diag?.operations) {
            engineOps = diag.operations;
          }
        } catch (_) {
          // If adapter diagnostics fail, engine ops will be empty (reported as unavailable)
        }

        return json(res, 200, {
          ...raw,
          engineState: snapshot.engineState || raw.engineState || 'UNKNOWN',
          engineStateRawNumeric: Number.isInteger(snapshot.engineStateRawNumeric)
            ? snapshot.engineStateRawNumeric
            : (Number.isInteger(raw.engineStateRawNumeric) ? raw.engineStateRawNumeric : null),
          engineStateRawLabel: String(snapshot.engineStateRawLabel || raw.engineStateRawLabel || 'UNKNOWN'),
          engineStateCanonical: snapshot.engineStateCanonical || raw.engineStateCanonical || null,
          queueLength: Number(snapshot.queueLength ?? raw.queueLength ?? 0),
          inkLevels: snapshot.inkLevels || extractInkLevels(raw),
          connected: Boolean(snapshot.connected ?? raw.connected),
          degraded: Boolean(snapshot.degraded ?? raw.degraded),
          capabilities: {
            movePrintheads: {
              supported: Boolean(moveHeadOp?.allowed),
              reason: moveHeadOp?.reason || null,
              positions: ['capped', 'raised', 'print']
            },
            engineInitialise: {
              supported: Boolean(engineOps?.initialiseEngine?.allowed),
              reason: engineOps?.initialiseEngine?.reason || 'Backend unavailable or operation not configured'
            },
            engineShutdown: {
              supported: Boolean(engineOps?.shutdownEngine?.allowed),
              reason: engineOps?.shutdownEngine?.reason || 'Backend unavailable or operation not configured'
            },
            engineReplaceWipers: {
              supported: Boolean(engineOps?.replaceWipers?.allowed),
              reason: engineOps?.replaceWipers?.reason || 'Backend unavailable or operation not configured'
            }
          },
          source: 'bridge-http',
          lastUpdate: snapshot.timestamp || raw.lastUpdate || new Date().toISOString(),
          // Same reboot phase as SSE — keeps HTTP fallback polls from clobbering the UI label.
          rebootState: rebootState ?? null
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/device/preflight') {
        const body = await parseBody(req);
        const preflight = await adapter.preflightFirstPrint({ requireStartPrint: Boolean(body.requireStartPrint) });
        return json(res, 200, preflight);
      }

      if (req.method === 'POST' && url.pathname === '/api/device/run-command') {
        const body = await parseBody(req);
        const command = String(body.command || '').trim();
        const handler = COMMAND_HANDLERS[command];
        if (!handler) return json(res, 400, { error: 'unsupported_command', command });

        const commandMeta = COMMAND_LOG_META[command] || null;
        logger.info({
          msg: 'bridge.command.dispatch',
          command,
          memjetMethod: commandMeta?.memjetMethod || null,
          args: commandMeta?.args || []
        });

        const startTime = Date.now();
        let result;
        let commandAccepted = true;
        let commandError = null;

        try {
          result = await handler(adapter);
        } catch (error) {
          const classified = classifyCommandRuntimeError(error, command);
          if (classified) {
            logger.error({ msg: 'bridge.command.runtime_mismatch', command, err: error?.message || String(error) });
            commandAccepted = false;
            commandError = { message: error?.message, code: classified.payload?.error };

            // Log failed command to DB
            try {
              if (store) {
                store.recordCommand({
                  command,
                  jobId: body.jobId || null,
                  accepted: false,
                  result: null,
                  error: commandError,
                  durationMs: Date.now() - startTime
                });
              }
            } catch {}

            return json(res, classified.status, classified.payload);
          }
          commandAccepted = false;
          commandError = { message: error?.message };
          throw error;
        }

        if (command.startsWith('head_') && hasSimulatedSignal(result)) {
          logger.error({ msg: 'bridge.command.rejected_simulated', command, result });

          // Log rejected simulated command to DB
          try {
            if (store) {
              store.recordCommand({
                command,
                jobId: body.jobId || null,
                accepted: false,
                result: result || null,
                error: { message: 'simulated_response_rejected' },
                durationMs: Date.now() - startTime
              });
            }
          } catch {}

          return json(res, 409, {
            accepted: false,
            error: 'simulated_response_rejected',
            message: `Command ${command} returned simulated/shim/no-op response and was rejected.`,
            command,
            result: result || null,
            timestamp: new Date().toISOString(),
            source: 'bridge-http'
          });
        }

        // Log successful command to DB
        try {
          if (store) {
            store.recordCommand({
              command,
              jobId: body.jobId || null,
              accepted: true,
              result: result || null,
              error: null,
              durationMs: Date.now() - startTime
            });
          }
        } catch {}

        return json(res, 200, {
          accepted: true,
          command,
          result: result || null,
          timestamp: new Date().toISOString(),
          source: 'bridge-http'
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/jobs') {
        const payload = await parseBody(req);
        const job = manager.createJob(payload);
        return json(res, 201, job);
      }

      if (req.method === 'POST' && url.pathname === '/api/jobs/ingest') {
        const payload = await parseBody(req);
        const job = manager.ingestJob(payload);
        return json(res, 201, job);
      }

      // Board composition job - proxies to Python FastAPI adapter
      // Accepts: { board_width_inches, board_height_inches, placements: [{pdf_path, x_inches, y_inches, scale, rotation_degrees, page_number}], args, env }
      if (req.method === 'POST' && url.pathname === '/api/jobs/board') {
        const adapterUrl = process.env.RIP_ADAPTER_URL || 'http://localhost:8080';
        const boardPayload = await parseBody(req);

        try {
          const adapterRes = await fetch(`${adapterUrl}/jobs/board`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(boardPayload)
          });

          if (!adapterRes.ok) {
            const errBody = await adapterRes.text();
            return json(res, adapterRes.status, { error: 'adapter_error', detail: errBody });
          }

          const result = await adapterRes.json();
          return json(res, 202, result);
        } catch (err) {
          logger.error({ msg: 'bridge.boardJob.proxyFailed', error: err.message });
          return json(res, 502, { error: 'bad_gateway', message: `Failed to reach adapter: ${err.message}` });
        }
      }

      // List all persisted jobs (read-only endpoint for hydration)
      if (req.method === 'GET' && url.pathname === '/api/jobs') {
        const store = manager.getStore?.();
        const jobs = store?.getAllJobs?.() || [];
        return json(res, 200, {
          jobs,
          source: 'bridge-http',
          timestamp: new Date().toISOString(),
          count: jobs.length
        });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
        const jobId = url.pathname.split('/')[3];
        const job = manager.getJob(jobId);
        if (!job) return json(res, 404, { error: 'job_not_found' });
        return json(res, 200, job);
      }

      if (req.method === 'POST' && /\/api\/jobs\/[^/]+\/send$/.test(url.pathname)) {
        const jobId = url.pathname.split('/')[3];
        const body = await parseBody(req);
        const job = await manager.sendJob(jobId, { copies: body.copies });
        return json(res, 200, job);
      }

      if (req.method === 'POST' && /\/api\/jobs\/[^/]+\/cancel$/.test(url.pathname)) {
        const jobId = url.pathname.split('/')[3];
        const job = await manager.cancelJob(jobId);
        return json(res, 200, job);
      }

      if (req.method === 'GET' && url.pathname === '/api/queue') {
        return json(res, 200, { queue: manager.getQueue() });
      }

      if (req.method === 'POST' && url.pathname === '/api/system/reboot') {
        // Resolve the same SSH settings the bridge already uses (root + private key)
        const rebootSshSettings = buildSshSettings({
          host: config?.memjet?.host,
          commandPort: config?.memjet?.commandPort,
          eventPort: config?.memjet?.eventPort,
          dataPort: config?.memjet?.dataPort
        });
        const rebootHost = rebootSshSettings.sshHost || '192.168.100.200';
        const rebootUser = rebootSshSettings.sshUser || 'root';
        const rebootKeyPath = rebootSshSettings.sshKeyPath;
        const rebootPort = rebootSshSettings.sshPort || 22;

        logger.info({ msg: 'bridge.system.reboot.request', host: rebootHost, user: rebootUser, keyPath: rebootKeyPath });
        process.stderr.write(
          `\n[REBOOT] Graceful reboot: engine_shutdown → wait OFF (live printhead) → sudo reboot — ${rebootUser}@${rebootHost}\n`
        );

        let privateKey;
        try {
          privateKey = fs.readFileSync(rebootKeyPath);
        } catch (keyErr) {
          const msg = 'Cannot read SSH key at ' + rebootKeyPath + ': ' + keyErr.message;
          process.stderr.write('[REBOOT] KEY ERROR: ' + msg + '\n\n');
          logger.error({ msg: 'bridge.system.reboot.key_error', keyPath: rebootKeyPath, err: keyErr.message });
          return json(res, 500, { error: 'reboot_failed', message: msg });
        }

        try {
          await pollSystemState();
          const beforeLabel = resolvedEngineUpperFromStatus(latestRawDeviceStatus);
          if (beforeLabel !== 'OFF' && beforeLabel !== '0') {
            process.stderr.write('[REBOOT] engine_shutdown — UI follows printhead (e.g. SHUTTING_DOWN → OFF)\n');
            logger.info({ msg: 'bridge.system.reboot.shutdown_start', host: rebootHost });
            await adapter.shutdownEngine({});
          } else {
            process.stderr.write('[REBOOT] Already OFF — skipping engine_shutdown\n');
            logger.info({ msg: 'bridge.system.reboot.skip_shutdown_already_off', host: rebootHost });
          }

          const offOk = await waitForEngineOff({ deadlineMs: 180000, pollMs: 1000 });
          if (!offOk) {
            process.stderr.write('[REBOOT] FAILED: engine did not reach OFF within 3 min\n\n');
            logger.error({ msg: 'bridge.system.reboot.off_timeout', host: rebootHost });
            return json(res, 500, {
              error: 'shutdown_off_timeout',
              message: 'Engine did not reach OFF within 3 minutes after shutdown. Host was not rebooted.'
            });
          }
          process.stderr.write('[REBOOT] OFF confirmed — host reboot phase (rebootState=rebooting)\n');
          logger.info({ msg: 'bridge.system.reboot.off_confirmed', host: rebootHost });

          setRebootState('rebooting');

          await new Promise((resolve, reject) => {
            let settled = false;
            const settle = (fn, val) => {
              if (settled) return;
              settled = true;
              fn(val);
            };

            const conn = new SshClient();

            conn.on('ready', () => {
              logger.info({ msg: 'bridge.system.reboot.ssh_ready', host: rebootHost, user: rebootUser });
              conn.exec('sudo reboot', (err, stream) => {
                if (err) {
                  try { conn.end(); } catch {}
                  return settle(reject, err);
                }
                // Resolve as soon as the command is handed off to the remote shell.
                // sudo reboot kills the SSH session before the stream can close cleanly —
                // waiting for stream 'close' here would hang indefinitely.
                logger.info({ msg: 'bridge.system.reboot.command_sent', host: rebootHost });
                settle(resolve, undefined);
                stream.on('data', () => {});
                stream.stderr.on('data', () => {});
                stream.on('close', () => { try { conn.end(); } catch {} });
              });
            });

            conn.on('error', (err) => {
              if (!settled) {
                const isAuthFail = /auth|permission denied|handshake/i.test(err.message);
                logger.error({ msg: 'bridge.system.reboot.ssh_error', err: err.message, authFailure: isAuthFail, host: rebootHost, user: rebootUser });
                if (isAuthFail) {
                  process.stderr.write(
                    '[REBOOT] SSH AUTH FAILED for ' + rebootUser + '@' + rebootHost + '\n' +
                    '[REBOOT] Key path used: ' + rebootKeyPath + '\n' +
                    '[REBOOT] Raw error: ' + err.message + '\n\n'
                  );
                } else {
                  process.stderr.write('[REBOOT] SSH connection error: ' + err.message + '\n\n');
                }
                settle(reject, err);
              } else {
                // Connection dropped after command was sent — expected, machine is rebooting
                logger.info({ msg: 'bridge.system.reboot.conn_dropped_after_reboot', err: err.message });
              }
            });

            conn.connect({
              host: rebootHost,
              port: rebootPort,
              username: rebootUser,
              privateKey,
              readyTimeout: 10000
            });
          });

          process.stderr.write('[REBOOT] Command sent successfully — ' + rebootHost + ' is rebooting.\n\n');
          logger.info({ msg: 'bridge.system.reboot.ok', host: rebootHost });

          // Start SSH reconnect watcher — will fire engine_initialise once machine is back
          startRebootWatcher({
            sshBin: rebootSshSettings.sshBin || 'ssh',
            sshHost: rebootHost,
            sshUser: rebootUser,
            sshKeyPath: rebootKeyPath,
            sshPort: rebootPort
          });

          return json(res, 200, { ok: true, message: 'Reboot command sent to ' + rebootHost });
        } catch (err) {
          process.stderr.write('[REBOOT] FAILED: ' + err.message + '\n\n');
          logger.error({ msg: 'bridge.system.reboot.failed', err: err.message, host: rebootHost });
          setRebootState(null); // SSH failed — clear the lock so UI recovers
          return json(res, 500, { error: 'reboot_failed', message: err.message });
        }
      }

      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      logger.error({ msg: 'bridge.request.error', path: url.pathname, err: error.message });
      if (error instanceof AdapterCapabilityError) {
        return json(res, 503, {
          error: 'adapter_unavailable',
          message: error.message,
          diagnostics: error.diagnostics || null
        });
      }
      return json(res, 500, { error: 'internal_error', message: error.message });
    }
  });

  let inFlightRequests = 0;
  let shuttingDown = false;

  const origEmit = server.emit.bind(server);
  server.emit = function (event, ...args) {
    if (event === 'request') {
      inFlightRequests++;
      const res = args[1];
      const onFinish = () => { inFlightRequests--; };
      res.on('finish', onFinish);
      res.on('close', onFinish);
    }
    return origEmit(event, ...args);
  };

  return {
    server,
    manager,
    config,
    get shuttingDown() { return shuttingDown; },
    async start() {
      // Run startup self-check before starting status polling
      const selfCheckResult = await performStartupSelfCheck({ config, logger, skipIfLocal: true });
      if (!selfCheckResult.ok && !selfCheckResult.skipped) {
        logger.error({
          msg: 'bridge.startup.selfCheckFailed',
          category: selfCheckResult.category,
          reason: selfCheckResult.reason,
          action: 'Set MEMJET_REAL_BACKEND=local to skip SSH self-check, or fix SSH configuration'
        });
        throw new Error(`Startup self-check failed: ${selfCheckResult.reason}`);
      }

      return new Promise(resolve => {
        server.listen(config.port, config.host, () => {
          statusPollTimer = setInterval(() => {
            pollSystemState();
          }, 1000);
          pollSystemState();
          logger.info({ msg: 'bridge.started', host: config.host, port: config.port, statusPollMs: 1000 });
          resolve();
        });
      });
    },
    async stop() {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ msg: 'bridge.shutdown.start', inFlight: inFlightRequests });

      if (statusPollTimer) clearInterval(statusPollTimer);
      statusPollTimer = null;

      for (const sub of subscribers) {
        try { sub.end(); } catch {}
      }
      subscribers.clear();
      for (const sub of statusSubscribers) {
        try { sub.end(); } catch {}
      }
      statusSubscribers.clear();

      const drainTimeoutMs = Number(process.env.RIP_BRIDGE_DRAIN_TIMEOUT_MS) || 5000;
      const deadline = Date.now() + drainTimeoutMs;
      while (inFlightRequests > 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (inFlightRequests > 0) {
        logger.warn({ msg: 'bridge.shutdown.drain_timeout', remaining: inFlightRequests });
      }

      await new Promise(resolve => server.close(() => resolve()));

      try { store?.close(); } catch {}
      logger.info({ msg: 'bridge.shutdown.complete' });
    }
  };
}

if (require.main === module) {
  const bridge = createBridgeServer();
  bridge.start().then(() => {
    const shutdown = async (signal) => {
      bridge.config._logger?.info?.({ msg: 'bridge.signal', signal }) ||
        console.log(`[bridge] received ${signal}, shutting down`);
      await bridge.stop();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });
}

module.exports = { createBridgeServer };
