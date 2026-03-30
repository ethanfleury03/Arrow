const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ENGINE_STATE_VALUE_TO_NAME,
  ENGINE_STATE_NAME_TO_UI,
  resolveEngineState,
  hasSimulatedSignal
} = require('../bridge/engine-state');

const ALLOWED_COMMANDS = new Set([
  'clean_light',
  'clean_medium',
  'clean_heavy',
  'prime_begin',
  'deprime_begin',
  'engine_initialise',
  'engine_shutdown',
  'engine_replace_wipers',
  'head_cap',
  'head_raise',
  'head_print',
  'print_finish',
  'clear',
  'initialise',
  'prepare',
  'start',
  'finish',
  'shutdown'
]);

class RipBackendError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RipBackendError';
    this.code = code;
    this.details = details;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function firstDefinedString(...values) {
  for (const value of values) {
    const str = String(value || '').trim();
    if (str) return str;
  }
  return '';
}

function normalizeInputPath(rawPath) {
  const value = firstDefinedString(rawPath);
  if (!value) return '';
  if (value.startsWith('file://')) {
    try {
      return decodeURIComponent(value.replace(/^file:\/\//i, ''));
    } catch {
      return value.replace(/^file:\/\//i, '');
    }
  }
  return value;
}

function isRetriableBridgeError(error) {
  if (!(error instanceof RipBackendError)) return false;
  if (error.code !== 'BRIDGE_UNAVAILABLE') return false;
  const status = Number(error?.details?.status);
  if (Number.isFinite(status) && status >= 500) return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('timeout') || message.includes('aborted') || message.includes('unavailable');
}

async function withRetry(task, { retries = 1, delayMs = 200 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetriableBridgeError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}


function mapStatusEngineState(status = {}, logger = null) {
  const resolved = resolveEngineState(status);

  if (process.env.RIP_STATUS_DEBUG === '1') {
    logger?.info?.('[rip-backend] status-map-detail', {
      extractedNumeric: resolved.numeric,
      rawEngineState: resolved.rawLabel,
      canonicalEngineState: resolved.canonical,
      mappedEngineState: resolved.engineState,
      extraction: resolved.extraction
    });
  }

  return resolved;
}

function signAuditEntry({ sessionId, timestamp, identity = {}, entry = {} }) {
  const username = String(identity.operatorUsername || 'unknown-operator').trim() || 'unknown-operator';
  const badgeId = String(identity.operatorBadgeId || 'unassigned').trim() || 'unassigned';
  const secret = String(identity.operatorIdentitySecret || '').trim();
  const message = JSON.stringify({ sessionId, timestamp, username, badgeId, entry });
  const digest = crypto.createHash('sha256').update(`${message}|${secret}`).digest('hex');
  return {
    username,
    badgeId,
    signature: digest,
    signatureVersion: 'sha256-v1'
  };
}

function ensureOperatorCommand(command) {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new RipBackendError(
      'UNSUPPORTED_COMMAND',
      `Command "${command || 'unknown'}" is not supported by backend bridge.`,
      { allowedCommands: Array.from(ALLOWED_COMMANDS) }
    );
  }
}

function validateLiveConfig(config = {}) {
  const host = String(config.host || '').trim();
  const commandPort = Number(config.commandPort);
  if (!host) {
    throw new RipBackendError('BACKEND_PREFLIGHT_FAILED', 'Missing config.host for live command execution.', {
      remediation: 'Set Host IP in Connection Wizard before running live commands.'
    });
  }
  if (!Number.isInteger(commandPort) || commandPort <= 0 || commandPort > 65535) {
    throw new RipBackendError('BACKEND_PREFLIGHT_FAILED', 'Invalid commandPort for live command execution.', {
      remediation: 'Set a valid command port (1-65535) in Connection Wizard before running live commands.'
    });
  }
}

function validateSubmitPayload(payload = {}) {
  const jobId = String(payload.jobId || '');
  const fileName = payload.fileName;
  const inputPath = firstDefinedString(payload.inputPath, payload.input_path, payload?.settings?.inputPath, payload?.settings?.input_path);
  const config = payload.config;
  const settings = payload.settings;

  if (!/^[A-Za-z0-9_-]{8,64}$/.test(jobId)) {
    throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Invalid submit payload: jobId must be 8-64 chars [A-Za-z0-9_-].', {
      remediation: 'Generate a deterministic job id before submit-job.'
    });
  }

  if ((!fileName || !String(fileName).trim()) && !inputPath) {
    throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Invalid submit payload: fileName or inputPath is required.', {
      remediation: 'Load artwork and pass fileName and/or inputPath when submitting.'
    });
  }

  if (!config || typeof config !== 'object') {
    throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Invalid submit payload: config object is required.', {
      remediation: 'Pass active runtime config in submit payload.'
    });
  }

  if (!settings || typeof settings !== 'object') {
    throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Invalid submit payload: settings object is required.', {
      remediation: 'Pass placement/settings in submit payload.'
    });
  }
}

function testTcpEndpoint({ host, port, timeoutMs = 1500 }) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, latencyMs: Date.now() - startedAt }));
    socket.once('timeout', () => finish({ ok: false, reason: 'timeout' }));
    socket.once('error', error => finish({ ok: false, reason: error.message }));

    const startedAt = Date.now();
    socket.connect(port, host);
  });
}

class BridgeHttpAdapter {
  constructor({ runtimeConfig, logger, timeoutMs = 5000 }) {
    this.name = 'bridge-http';
    this.runtimeConfig = runtimeConfig || {};
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }

  getBridgeBaseUrl() {
    const host = String(this.runtimeConfig.bridgeHost || process.env.RIP_BRIDGE_HOST || '127.0.0.1').trim();
    const port = Number(this.runtimeConfig.bridgePort || process.env.RIP_BRIDGE_PORT || 8787);
    return `http://${host}:${port}`;
  }

  getAdapterBaseUrl() {
    const host = String(
      this.runtimeConfig.adapterHost
      || process.env.RIP_ADAPTER_HOST
      || this.runtimeConfig.bridgeHost
      || process.env.RIP_BRIDGE_HOST
      || '127.0.0.1'
    ).trim();
    const port = Number(
      this.runtimeConfig.adapterPort
      || process.env.RIP_ADAPTER_PORT
      || 8081
    );
    return `http://${host}:${port}`;
  }

  async request(method, endpoint, payload, { baseUrl } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const resolvedBaseUrl = String(baseUrl || this.getBridgeBaseUrl()).replace(/\/$/, '');
    const url = `${resolvedBaseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: payload == null ? undefined : JSON.stringify(payload),
        signal: controller.signal
      });

      const text = await response.text();
      let body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { raw: text };
      }

      if (!response.ok) {
        if (response.status === 409 && String(body?.error || '').trim().toLowerCase() === 'simulated_response_rejected') {
          throw new RipBackendError(
            'COMMAND_REJECTED_SIMULATED',
            `HTTP bridge rejected simulated command response for ${endpoint}.`,
            {
              endpoint,
              status: response.status,
              remediation: 'Bridge rejected simulated/shim/no-op response. Use a real implemented endpoint path for this command.',
              bridgeResponse: body
            }
          );
        }

        throw new RipBackendError(
          'BRIDGE_UNAVAILABLE',
          `HTTP bridge request failed (${response.status}) for ${endpoint}.`,
          {
            endpoint,
            status: response.status,
            remediation: `Ensure backend service is running at ${resolvedBaseUrl} and reachable from Electron.`,
            bridgeResponse: body
          }
        );
      }

      return body;
    } catch (error) {
      if (error instanceof RipBackendError) throw error;
      throw new RipBackendError('BRIDGE_UNAVAILABLE', `HTTP bridge unavailable for ${endpoint}: ${error.message}`, {
        endpoint,
        remediation: `Start the bridge backend and verify ${resolvedBaseUrl}/api/health responds.`
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async getStatus() {
    // Primary: legacy bridge status endpoint.
    try {
      const status = await this.request('GET', '/api/device/status', undefined, { baseUrl: this.getBridgeBaseUrl() });
      const resolvedState = mapStatusEngineState(status, this.logger);

      if (process.env.RIP_STATUS_DEBUG === '1') {
        this.logger?.info?.('[rip-backend] status-map', {
          rawEngine: status?.engine,
          rawProductInfo: status?.details?.productInfo || null,
          rawEngineState: resolvedState.rawLabel,
          canonicalEngineState: resolvedState.canonical,
          mappedEngineState: resolvedState.engineState,
          source: 'bridge-http'
        });
      }

      return {
        engineState: resolvedState.engineState,
        engineStateRawNumeric: resolvedState.numeric,
        engineStateRawLabel: resolvedState.rawLabel,
        engineStateCanonical: resolvedState.canonical,
        queueLength: Number(status?.queueLength ?? status?.details?.queueLength ?? 0),
        faults: [],
        inkLevels: status?.inkLevels || null,
        details: status?.details || null,
        timestamp: status?.lastUpdate || nowIso()
      };
    } catch (_bridgeError) {
      // Fallback: RIP adapter health endpoint when bridge status API is unavailable.
      const health = await this.request('GET', '/health', undefined, { baseUrl: this.getAdapterBaseUrl() });
      return {
        engineState: health?.ok ? 'READY' : 'UNKNOWN',
        engineStateRawNumeric: null,
        engineStateRawLabel: health?.ok ? 'ADAPTER_OK' : 'UNKNOWN',
        engineStateCanonical: health?.ok ? 'READY' : null,
        queueLength: 0,
        faults: [],
        timestamp: nowIso()
      };
    }
  }

  async runCommand(payload) {
    ensureOperatorCommand(payload?.command);
    return this.request('POST', '/api/device/run-command', { command: payload.command, config: payload?.config || {} });
  }

  async ingestJob(payload) {
    validateSubmitPayload(payload || {});

    const inputPath = normalizeInputPath(firstDefinedString(
      payload?.inputPath,
      payload?.input_path,
      payload?.settings?.inputPath,
      payload?.settings?.input_path
    ));

    if (!inputPath) {
      throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Missing input_path for RIP adapter submission.', {
        remediation: 'Load artwork from a real filesystem path in Electron and provide payload.inputPath.'
      });
    }

    const resolvedInputPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath);
    if (!fs.existsSync(resolvedInputPath)) {
      throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', `Input file does not exist: ${resolvedInputPath}`, {
        remediation: 'Re-select artwork in UI and retry so Electron sends a valid local filesystem path.'
      });
    }

    const copies = Number.isFinite(Number(payload?.copies))
      ? Math.max(1, Math.floor(Number(payload.copies)))
      : 1;

    const ingest = await withRetry(() => this.request('POST', '/api/jobs/ingest', {
      jobId: firstDefinedString(payload?.jobId) || undefined,
      filePath: resolvedInputPath,
      fileName: firstDefinedString(payload?.fileName) || path.basename(resolvedInputPath),
      copies
    }, { baseUrl: this.getBridgeBaseUrl() }), { retries: 1, delayMs: 250 });

    const bridgeJobId = firstDefinedString(ingest?.jobId, ingest?.id, payload?.jobId);
    if (!bridgeJobId) {
      throw new RipBackendError('BRIDGE_UNAVAILABLE', 'Bridge ingest did not return a job id.', {
        remediation: 'Verify bridge /api/jobs/ingest response contract includes jobId.'
      });
    }

    return {
      accepted: true,
      status: 'queued',
      message: null,
      jobId: bridgeJobId,
      timestamp: nowIso()
    };
  }

  async sendQueuedJob(payload) {
    const bridgeJobId = firstDefinedString(payload?.bridgeJobId, payload?.jobId);
    if (!bridgeJobId) {
      throw new RipBackendError('BACKEND_SUBMIT_INVALID_PAYLOAD', 'Missing bridge job id for queued send.', {
        remediation: 'Ingest/rasterize the PDF first, then send the queued bridge job id.'
      });
    }

    const copies = Number.isFinite(Number(payload?.copies))
      ? Math.max(1, Math.floor(Number(payload.copies)))
      : 1;

    const sent = await withRetry(() => this.request('POST', `/api/jobs/${bridgeJobId}/send`, { copies }, { baseUrl: this.getBridgeBaseUrl() }), { retries: 1, delayMs: 250 });
    const finalStatus = firstDefinedString(sent?.state, sent?.status, 'completed');

    return {
      accepted: true,
      status: finalStatus,
      message: null,
      jobId: bridgeJobId,
      timestamp: nowIso()
    };
  }

  async submitJob(payload) {
    const staged = await this.ingestJob(payload);
    return this.sendQueuedJob({ bridgeJobId: staged.jobId, copies: payload?.copies });
  }
}

class BridgeUnavailableAdapter {
  constructor({ reason = 'Bridge adapter is unavailable.' } = {}) {
    this.name = 'bridge-unavailable';
    this.reason = reason;
  }

  fail(operation) {
    throw new RipBackendError('BRIDGE_UNAVAILABLE', `${operation} failed: ${this.reason}`, {
      remediation: 'Set RIP_BACKEND_MODE=bridge-http and start bridge/server.js on configured bridge host/port.'
    });
  }

  async getStatus() {
    this.fail('status');
  }

  async runCommand() {
    this.fail('run-command');
  }

  async ingestJob() {
    this.fail('ingest-job');
  }

  async sendQueuedJob() {
    this.fail('send-queued-job');
  }

  async submitJob() {
    this.fail('submit-job');
  }
}

function parseInkLevelsFromStatusPayload(status = {}) {
  if (status?.inkLevels && typeof status.inkLevels === 'object') {
    return {
      C: Math.max(0, Math.min(100, Number(status.inkLevels.C) || 0)),
      M: Math.max(0, Math.min(100, Number(status.inkLevels.M) || 0)),
      Y: Math.max(0, Math.min(100, Number(status.inkLevels.Y) || 0)),
      K: Math.max(0, Math.min(100, Number(status.inkLevels.K) || 0))
    };
  }

  const outputCandidates = [
    status?.details?.productInfo?.output,
    status?.details?.productInfo?.result?.output,
    status?.details?.productInfo?.rawStdout,
    status?.details?.productInfo?.resultRepr,
    status?.details?.diagnostics?.lastRealCall?.result?.output
  ]
    .map(v => String(v || ''))
    .filter(Boolean);

  const scanText = `${outputCandidates.join('\n')}\n${JSON.stringify(status || {})}`;
  if (!scanText.trim()) return null;

  const byColor = {};
  const tankRegex = /InkTankStatus\(([^)]*)\)/g;
  let match;
  while ((match = tankRegex.exec(scanText)) !== null) {
    const chunk = match[1] || '';
    const cap = Number((/inkCapacity\s*=\s*([0-9.]+)/i.exec(chunk) || [])[1]);
    const rem = Number((/inkRemaining\s*=\s*([0-9.]+)/i.exec(chunk) || [])[1]);
    const color = Number((/color\s*=\s*(\d+)/i.exec(chunk) || [])[1]);
    if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(rem) || !Number.isInteger(color)) continue;
    byColor[color] = Math.max(0, Math.min(100, Math.round((rem / cap) * 100)));
  }

  if (!Object.keys(byColor).length) return null;
  return {
    C: Number.isFinite(byColor[1]) ? byColor[1] : 0,
    M: Number.isFinite(byColor[2]) ? byColor[2] : 0,
    Y: Number.isFinite(byColor[3]) ? byColor[3] : 0,
    K: Number.isFinite(byColor[4]) ? byColor[4] : 0
  };
}

function createAdapter({ mode, logger, runtimeConfig }) {
  if (mode === 'bridge-http') {
    return new BridgeHttpAdapter({ runtimeConfig, logger, timeoutMs: Number(process.env.RIP_BRIDGE_TIMEOUT_MS || 5000) });
  }

  if (mode === 'thrift-cli' && process.env.RIP_ALLOW_THRIFT_CLI_DEV === '1') {
    logger?.warn?.('[rip-backend] thrift-cli requested in dev override mode; production must use bridge-http.');
    return new BridgeUnavailableAdapter({ reason: 'thrift-cli path disabled in this build; use bridge-http.' });
  }

  return new BridgeUnavailableAdapter({ reason: `Unsupported backend mode "${mode}".` });
}

function createRipBackend({ mode = process.env.RIP_BACKEND_MODE || 'bridge-http', logger = console, runtimeConfig = {}, userDataPath = process.cwd() } = {}) {
  const adapter = createAdapter({ mode, logger, runtimeConfig });
  const sessionId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const auditFilePath = path.join(userDataPath, 'rip-operator-audit.ndjson');

  return {
    mode,
    adapter: adapter.name,
    sessionId,
    runtimeConfig,

    getRuntimeConfig() {
      return {
        mode,
        adapter: adapter.name,
        sessionId,
        runtimeConfig
      };
    },

    async appendAudit(entry) {
      const timestamp = nowIso();
      const operator = signAuditEntry({
        sessionId,
        timestamp,
        identity: runtimeConfig,
        entry
      });

      const payload = {
        sessionId,
        timestamp,
        operator,
        ...entry
      };
      fs.appendFileSync(auditFilePath, `${JSON.stringify(payload)}\n`, 'utf8');
      return { ok: true, filePath: auditFilePath, timestamp: payload.timestamp, operator };
    },

    async getStatus(config) {
      const status = await adapter.getStatus(config);
      return {
        engineState: status?.engineState || 'UNKNOWN',
        engineStateRawNumeric: Number.isInteger(status?.engineStateRawNumeric) ? status.engineStateRawNumeric : null,
        engineStateRawLabel: String(status?.engineStateRawLabel || '').trim() || 'UNKNOWN',
        engineStateCanonical: String(status?.engineStateCanonical || '').trim() || null,
        queueLength: Number(status?.queueLength || 0),
        inkLevels: parseInkLevelsFromStatusPayload(status),
        faults: Array.isArray(status?.faults) ? status.faults : [],
        timestamp: status?.timestamp || nowIso(),
        source: `electron-${adapter.name}`
      };
    },

    async runCommand(payload) {
      const data = payload || {};
      validateLiveConfig(data?.config || {});
      const result = await adapter.runCommand(data);
      return {
        accepted: Boolean(result?.accepted ?? true),
        command: payload?.command || result?.command || 'unknown',
        timestamp: result?.timestamp || nowIso(),
        source: `electron-${adapter.name}`,
        message: result?.message || null,
        warnings: Array.isArray(result?.warnings) ? result.warnings : [],
        bridgeResult: result?.result || null,
        bridgeError: result?.error || null
      };
    },

    async ingestJob(payload) {
      validateSubmitPayload(payload || {});
      validateLiveConfig(payload?.config || {});
      const result = await adapter.ingestJob(payload || {});
      return {
        accepted: Boolean(result?.accepted),
        status: result?.status || (result?.accepted ? 'queued' : 'rejected'),
        message: result?.message || null,
        jobId: result?.jobId || payload?.jobId || null,
        timestamp: result?.timestamp || nowIso(),
        source: `electron-${adapter.name}`
      };
    },

    async sendQueuedJob(payload) {
      const result = await adapter.sendQueuedJob(payload || {});
      return {
        accepted: Boolean(result?.accepted),
        status: result?.status || (result?.accepted ? 'submitted' : 'rejected'),
        message: result?.message || null,
        jobId: result?.jobId || payload?.bridgeJobId || payload?.jobId || null,
        timestamp: result?.timestamp || nowIso(),
        source: `electron-${adapter.name}`
      };
    },

    async submitJob(payload) {
      validateSubmitPayload(payload || {});
      validateLiveConfig(payload?.config || {});
      const result = await adapter.submitJob(payload || {});
      return {
        accepted: Boolean(result?.accepted),
        status: result?.status || (result?.accepted ? 'submitted' : 'rejected'),
        message: result?.message || null,
        jobId: result?.jobId || payload?.jobId || null,
        timestamp: result?.timestamp || nowIso(),
        source: `electron-${adapter.name}`
      };
    },

    async testEndpoint(endpoint) {
      const host = String(endpoint?.host || '').trim();
      const port = Number(endpoint?.port);
      const kind = String(endpoint?.kind || 'unknown');

      if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
        return {
          ok: false,
          message: 'Invalid endpoint config. Host and port are required.',
          kind,
          timestamp: nowIso()
        };
      }

      const probe = await testTcpEndpoint({ host, port });
      if (probe.ok) {
        return {
          ok: true,
          message: `TCP probe succeeded for ${kind} endpoint (${host}:${port}).`,
          kind,
          latencyMs: probe.latencyMs,
          timestamp: nowIso()
        };
      }

      return {
        ok: false,
        message: `TCP probe failed for ${kind} endpoint (${host}:${port}): ${probe.reason}`,
        kind,
        timestamp: nowIso()
      };
    }
  };
}

module.exports = {
  RipBackendError,
  createRipBackend
};