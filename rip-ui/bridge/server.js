const http = require('node:http');
const { URL } = require('node:url');
const { loadBridgeConfig } = require('./config');
const { createLogger } = require('./logger');
const { createMemjetAdapter, AdapterCapabilityError } = require('./memjet-adapter');
const { JobManager } = require('./job-manager');

function json(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', chunk => { buf += String(chunk); });
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

function hasSimulatedSignal(value, depth = 0) {
  if (depth > 4 || value == null) return false;

  if (typeof value === 'boolean') return value === true;

  if (typeof value === 'string') {
    const src = value.trim().toLowerCase();
    return src.includes('simulat') || src.includes('shim') || src.includes('no-op') || src.includes('noop') || src.includes('dry-run') || src.includes('dry run');
  }

  if (Array.isArray(value)) {
    return value.some(item => hasSimulatedSignal(item, depth + 1));
  }

  if (typeof value === 'object') {
    if (value.simulated === true || value.shim === true || value.noop === true || value.noOp === true || value.dryRun === true) {
      return true;
    }

    return Object.entries(value).some(([key, val]) => {
      const keyLc = String(key || '').toLowerCase();
      if (['simulated', 'shim', 'noop', 'noop', 'dryrun', 'dry_run'].includes(keyLc)) {
        return hasSimulatedSignal(val, depth + 1);
      }
      if (['message', 'reason', 'note', 'status', 'resultrepr', 'output'].includes(keyLc)) {
        return hasSimulatedSignal(val, depth + 1);
      }
      return false;
    });
  }

  return false;
}

function firstDefinedString(...values) {
  for (const value of values) {
    const str = String(value || '').trim();
    if (str) return str;
  }
  return '';
}


const ENGINE_STATE_VALUE_TO_NAME = Object.freeze({
  1: 'OFF',
  2: 'FAULT',
  3: 'TESTING',
  4: 'INITIALISING',
  5: 'DEPRIMED_IDLE',
  6: 'PRIMED_IDLE',
  7: 'SERVICING',
  8: 'PRE_JOB',
  9: 'PRINT_READY',
  10: 'PRINTING',
  11: 'MID_JOB',
  12: 'PAUSED',
  13: 'SESSION_COMPLETE',
  14: 'POST_JOB',
  15: 'SHUTTING_DOWN',
  16: 'PAUSING'
});

const ENGINE_STATE_NAME_TO_UI = Object.freeze({
  OFF: 'OFF',
  FAULT: 'FAULT',
  TESTING: 'IDLE',
  INITIALISING: 'IDLE',
  DEPRIMED_IDLE: 'READY',
  PRIMED_IDLE: 'READY',
  SERVICING: 'IDLE',
  PRE_JOB: 'READY',
  PRINT_READY: 'READY',
  PRINTING: 'PRINTING',
  MID_JOB: 'PRINTING',
  PAUSED: 'READY',
  SESSION_COMPLETE: 'READY',
  POST_JOB: 'IDLE',
  SHUTTING_DOWN: 'IDLE',
  PAUSING: 'PRINTING'
});

function parseEngineStateNumberFromRaw(text) {
  const src = String(text || '');
  if (!src) return null;
  const match = src.match(/engineStatus\s*[=.:]\s*[^\n\r]*?state\s*[=:]\s*(\d{1,3})/i)
    || src.match(/engineStatus\.state\s*[=:]\s*(\d{1,3})/i)
    || src.match(/\bstate\s*[=:]\s*(\d{1,3})\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function extractEmbeddedJsonRawFromOutput(text) {
  const src = String(text || '');
  if (!src) return null;

  const lines = src.split(/\r?\n/);
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed.raw === 'string' && parsed.raw.trim()) {
        return parsed.raw;
      }
    } catch {}
  }

  return null;
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

function resolveEngineState(status = {}) {
  const details = status?.details || {};
  const productInfo = details?.productInfo || {};

  const directNamedCandidates = [
    ['status.engineStateRawLabel', status?.engineStateRawLabel],
    ['details.engineStateRawLabel', details?.engineStateRawLabel],
    ['status.engineState', status?.engineState],
    ['details.engineState', details?.engineState],
    ['details.engine', details?.engine],
    ['productInfo.engineState', productInfo?.engineState],
    ['productInfo.engine', productInfo?.engine],
    ['productInfo.status.engineState', productInfo?.status?.engineState],
    ['productInfo.status.engine', productInfo?.status?.engine],
    ['productInfo.status.state', productInfo?.status?.state],
    ['productInfo.state', productInfo?.state]
  ];

  let extraction = 'unknown';
  let rawLabel = '';
  let numeric = Number.isInteger(status?.engineStateRawNumeric)
    ? Number(status.engineStateRawNumeric)
    : null;

  for (const [source, value] of directNamedCandidates) {
    if (typeof value === 'string' && value.trim()) {
      const candidate = value.trim().toUpperCase();
      if (candidate !== 'UNKNOWN') {
        rawLabel = candidate;
        extraction = source;
        break;
      }
    }
    if (typeof value === 'number' && Number.isInteger(value)) {
      numeric = value;
      rawLabel = ENGINE_STATE_VALUE_TO_NAME[value] || '';
      extraction = `${source}:numeric`;
      if (rawLabel) break;
    }
  }

  if (!rawLabel) {
    const embeddedRaw = extractEmbeddedJsonRawFromOutput(productInfo?.output);
    if (embeddedRaw) {
      const parsed = parseEngineStateNumberFromRaw(embeddedRaw);
      if (parsed != null) {
        numeric = parsed;
        rawLabel = ENGINE_STATE_VALUE_TO_NAME[parsed] || '';
        extraction = 'productInfo.output.embeddedJson.raw:regex';
      }
    }

    if (!rawLabel) {
      const rawTextCandidates = [
        ['productInfo.output', productInfo?.output],
        ['productInfo.resultRepr', productInfo?.resultRepr],
        ['productInfo.rawStdout', productInfo?.rawStdout],
        ['productInfo.raw', productInfo?.raw],
        ['details.raw', details?.raw],
        ['status.raw', status?.raw],
        ['status.output', status?.output],
        ['details.output', details?.output]
      ];
      for (const [source, raw] of rawTextCandidates) {
        const parsed = parseEngineStateNumberFromRaw(raw);
        if (parsed != null) {
          numeric = parsed;
          rawLabel = ENGINE_STATE_VALUE_TO_NAME[parsed] || '';
          extraction = `${source}:regex`;
          break;
        }
      }
    }
  }

  if (!rawLabel && numeric == null) {
    const serialized = JSON.stringify(status || {});
    const parsed = parseEngineStateNumberFromRaw(serialized);
    if (parsed != null) {
      numeric = parsed;
      rawLabel = ENGINE_STATE_VALUE_TO_NAME[parsed] || '';
      extraction = 'status.serialized:regex';
    }
  }

  const canonical = rawLabel || (numeric != null ? ENGINE_STATE_VALUE_TO_NAME[numeric] || '' : '');
  const canonicalUi = ENGINE_STATE_NAME_TO_UI[canonical] || (canonical || 'UNKNOWN');
  const displayRawLabel = rawLabel || (numeric != null ? `STATE_${numeric}` : 'UNKNOWN');

  return {
    numeric,
    rawLabel: displayRawLabel,
    canonical: canonical || null,
    engineState: canonicalUi || 'UNKNOWN',
    extraction
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

  let statusPollTimer = null;
  let statusPollInFlight = false;
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
    if (statusPollInFlight) return;
    statusPollInFlight = true;

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

        let result;
        try {
          result = await handler(adapter);
        } catch (error) {
          const classified = classifyCommandRuntimeError(error, command);
          if (classified) {
            logger.error({ msg: 'bridge.command.runtime_mismatch', command, err: error?.message || String(error) });
            return json(res, classified.status, classified.payload);
          }
          throw error;
        }

        if (command.startsWith('head_') && hasSimulatedSignal(result)) {
          logger.error({ msg: 'bridge.command.rejected_simulated', command, result });
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

  return {
    server,
    manager,
    config,
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
    stop() {
      return new Promise(resolve => {
        if (statusPollTimer) clearInterval(statusPollTimer);
        statusPollTimer = null;
        server.close(() => resolve());
      });
    }
  };
}

if (require.main === module) {
  const bridge = createBridgeServer();
  bridge.start();
}

module.exports = { createBridgeServer };
