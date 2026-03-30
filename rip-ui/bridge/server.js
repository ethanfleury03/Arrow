const http = require('node:http');
const { URL } = require('node:url');
const { loadBridgeConfig } = require('./config');
const { createLogger } = require('./logger');
const { createMemjetAdapter, AdapterCapabilityError } = require('./memjet-adapter');
const { JobManager } = require('./job-manager');
const {
  ENGINE_STATE_VALUE_TO_NAME,
  ENGINE_STATE_NAME_TO_UI,
  parseEngineStateNumberFromRaw,
  extractEmbeddedJsonRawFromOutput,
  hasSimulatedSignal,
  resolveEngineState
} = require('./engine-state');

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
        degraded: snapshot.degraded
      });

      if (signature !== lastStatusSignature) {
        lastStatusSignature = signature;
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
        error: String(error?.message || error)
      };

      latestRawDeviceStatus = latestRawDeviceStatus || { connected: false, degraded: true, details: {} };
      latestSystemState = fallback;
      const signature = JSON.stringify({ engineState: fallback.engineState, connected: fallback.connected, degraded: fallback.degraded, error: fallback.error });
      if (signature !== lastStatusSignature) {
        lastStatusSignature = signature;
        emitSystemState(fallback);
      }
      logger.error({ msg: 'bridge.status.poll.error', err: error?.message || String(error) });
    } finally {
      statusPollInFlight = false;
    }
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
          lastUpdate: snapshot.timestamp || raw.lastUpdate || new Date().toISOString()
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
    start() {
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
