const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

class MemjetAdapter {
  async checkConnectivity() {}
  async preflightFirstPrint() {}
  async clearQueue() {}
  async initialiseEngine() {}
  async shutdownEngine() {}
  async submitJobData() {}
  async prepareToPrint() {}
  async startPrinting() {}
  async finishPrinting() {}
  async startServicing() {}
  async startPriming() {}
  async startDepriming() {}
  async replaceWipers() {}
  async startMovingPrintheads() {}
  async pausePrinting() {}
  async cancelJob() {}
}

class AdapterCapabilityError extends Error {
  constructor(message, diagnostics = {}) {
    super(message);
    this.name = 'AdapterCapabilityError';
    this.code = 'adapter_unavailable';
    this.diagnostics = diagnostics;
  }
}

function resolvePathMaybe(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function checkTcp(host, port, timeoutMs = 700) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch (_) {}
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, reason: 'timeout' }));
    socket.once('error', err => finish({ ok: false, reason: err.code || err.message }));
    socket.connect(port, host);
  });
}

class ThriftMemjetAdapter extends MemjetAdapter {
  constructor({ logger, config }) {
    super();
    this.logger = logger;
    this.config = config;
    this._clientFactory = null;
    this._thrift = null;
    this._client = null;
    this._productInfo = null;
    this._lastRealCall = null;
  }

  _recordRealCall(operation, ok, summary) {
    this._lastRealCall = {
      at: new Date().toISOString(),
      operation,
      ok: Boolean(ok),
      summary: summary || null
    };
  }

  _buildGateState() {
    const gates = {
      enableRealCommands: Boolean(this.config.enableRealCommands),
      enableRealStartPrint: Boolean(this.config.enableRealStartPrint),
      dryRunRealSequence: Boolean(this.config.dryRunRealSequence)
    };

    const operations = {
      statusQuery: { allowed: true, reason: null },
      clearQueue: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' },
      initialiseEngine: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' },
      shutdownEngine: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' },
      prepareToPrint: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' },
      startServicing: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' },
      startPriming: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' },
      startDepriming: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' },
      replaceWipers: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' },
      startMovingPrintheads: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' },
      pausePrinting: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' },
      submitJobData: { allowed: Boolean(this.config.allowDataSubmission), reason: this.config.allowDataSubmission ? null : 'MEMJET_ALLOW_DATA_SUBMISSION=false (JSL/raster path not finalized)' },
      startPrinting: {
        allowed: gates.enableRealCommands && gates.enableRealStartPrint && !gates.dryRunRealSequence,
        reason: gates.dryRunRealSequence
          ? 'RIP_BRIDGE_REAL_DRY_RUN=true blocks physical start'
          : (!gates.enableRealCommands ? 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' : (!gates.enableRealStartPrint ? 'RIP_BRIDGE_ENABLE_REAL_START_PRINT=false' : null))
      },
      finishPrinting: { allowed: gates.enableRealCommands, reason: gates.enableRealCommands ? null : 'RIP_BRIDGE_ENABLE_REAL_COMMANDS=false' }
    };

    return { gates, operations };
  }

  _loadThriftModule() {
    if (this._thrift !== null) return this._thrift;
    try {
      this._thrift = require('thrift');
      return this._thrift;
    } catch (_) {
      this._thrift = false;
      return false;
    }
  }

  _loadClientFactory() {
    if (this._clientFactory !== null) return this._clientFactory;

    if (this.config.clientFactoryPath) {
      try {
        const mod = require(resolvePathMaybe(this.config.clientFactoryPath));
        const fn = typeof mod === 'function' ? mod : mod.createClient;
        if (typeof fn === 'function') {
          this._clientFactory = fn;
          return this._clientFactory;
        }
      } catch (error) {
        this.logger.warn({ msg: 'memjet.clientFactory.load.failed', err: error.message, path: this.config.clientFactoryPath });
      }
    }

    this._clientFactory = false;
    return false;
  }

  async _buildDiagnostics() {
    const thriftLoadable = Boolean(this._loadThriftModule());
    const clientFactoryLoadable = Boolean(this._loadClientFactory());
    const commandReach = await checkTcp(this.config.host, this.config.commandPort, this.config.connectTimeoutMs);
    const eventReach = await checkTcp(this.config.host, this.config.eventPort, this.config.connectTimeoutMs);
    const gateState = this._buildGateState();

    const diagnostics = {
      mode: 'real',
      protocol: this.config.protocol,
      host: this.config.host,
      ports: {
        command: this.config.commandPort,
        event: this.config.eventPort,
        data: this.config.dataPort
      },
      configured: Boolean(this.config.host && this.config.commandPort),
      thriftLoadable,
      clientFactoryLoadable,
      commandReachable: commandReach.ok,
      commandReachReason: commandReach.reason || null,
      eventReachable: eventReach.ok,
      eventReachReason: eventReach.reason || null,
      gates: gateState.gates,
      operations: gateState.operations,
      lastRealCall: this._lastRealCall,
      capability: {
        controlPlaneReady: thriftLoadable && clientFactoryLoadable && commandReach.ok,
        dataPlaneReady: Boolean(this.config.allowDataSubmission)
      }
    };

    return diagnostics;
  }

  async _ensureControlPlane() {
    const diagnostics = await this._buildDiagnostics();
    if (!diagnostics.capability.controlPlaneReady) {
      throw new AdapterCapabilityError(
        'Real Memjet control-plane unavailable. Install/load thrift + client factory and ensure command port is reachable.',
        diagnostics
      );
    }
    return diagnostics;
  }

  async _ensureClient() {
    if (this._client) return this._client;

    await this._ensureControlPlane();

    const createClient = this._loadClientFactory();
    this._client = await createClient({
      host: this.config.host,
      commandPort: this.config.commandPort,
      eventPort: this.config.eventPort,
      dataPort: this.config.dataPort,
      protocol: this.config.protocol,
      transport: this.config.transport,
      thrift: this._loadThriftModule(),
      logger: this.logger
    });

    if (!this._client || typeof this._client !== 'object') {
      throw new AdapterCapabilityError('Client factory did not return a usable client object', await this._buildDiagnostics());
    }

    return this._client;
  }

  async _statusQuery() {
    const client = await this._ensureClient();

    if (typeof client.getStatus === 'function') {
      const result = await client.getStatus();
      this._recordRealCall('getStatus', true, 'status query succeeded');
      return result;
    }

    if (typeof client.getProductInfo === 'function') {
      const result = await client.getProductInfo();
      this._recordRealCall('getProductInfo', true, 'product info query succeeded');
      return result;
    }

    throw new AdapterCapabilityError(
      'Client missing required read-only status method (getStatus or getProductInfo)',
      await this._buildDiagnostics()
    );
  }

  async checkConnectivity() {
    const diagnostics = await this._buildDiagnostics();

    if (diagnostics.capability.controlPlaneReady) {
      try {
        const status = await this._statusQuery();
        this._productInfo = status || null;
      } catch (error) {
        diagnostics.capability.controlPlaneReady = false;
        diagnostics.clientError = error.message;
        this._recordRealCall('statusQuery', false, error.message);
      }
    }

    diagnostics.lastRealCall = this._lastRealCall;

    return {
      ok: Boolean(diagnostics.capability.controlPlaneReady),
      connected: Boolean(diagnostics.capability.controlPlaneReady),
      degraded: !diagnostics.capability.controlPlaneReady,
      diagnostics,
      productInfo: this._productInfo || null
    };
  }

  async preflightFirstPrint({ requireStartPrint = true } = {}) {
    const status = await this.checkConnectivity();
    const diagnostics = status.diagnostics || {};
    const checks = [
      {
        id: 'controlPlaneReady',
        passed: Boolean(diagnostics?.capability?.controlPlaneReady),
        required: true,
        detail: diagnostics?.capability?.controlPlaneReady ? 'Control plane reachable and status query succeeded' : 'Control plane not ready'
      },
      {
        id: 'realCommandsGate',
        passed: Boolean(diagnostics?.gates?.enableRealCommands),
        required: true,
        detail: diagnostics?.gates?.enableRealCommands ? 'Real command gate enabled' : 'Set RIP_BRIDGE_ENABLE_REAL_COMMANDS=true'
      },
      {
        id: 'startPrintGate',
        passed: Boolean(diagnostics?.gates?.enableRealStartPrint) && !Boolean(diagnostics?.gates?.dryRunRealSequence),
        required: Boolean(requireStartPrint),
        detail: diagnostics?.gates?.dryRunRealSequence
          ? 'Dry-run mode enabled; physical start will be blocked'
          : (diagnostics?.gates?.enableRealStartPrint ? 'Start print gate enabled' : 'Set RIP_BRIDGE_ENABLE_REAL_START_PRINT=true')
      },
      {
        id: 'dataSubmissionPath',
        passed: Boolean(diagnostics?.operations?.submitJobData?.allowed),
        required: false,
        detail: diagnostics?.operations?.submitJobData?.allowed
          ? 'Data submission operation enabled'
          : 'MEMJET_ALLOW_DATA_SUBMISSION=false, real JSL/raster submission is still guarded'
      }
    ];

    const failedRequired = checks.filter(c => c.required && !c.passed);

    return {
      passed: failedRequired.length === 0,
      requireStartPrint: Boolean(requireStartPrint),
      dryRun: Boolean(diagnostics?.gates?.dryRunRealSequence),
      checks,
      diagnostics
    };
  }

  async _call(method, args = [], jobId) {
    const client = await this._ensureClient();
    if (typeof client[method] !== 'function') {
      throw new AdapterCapabilityError(`Client missing required method: ${method}`, await this._buildDiagnostics());
    }
    this.logger.info({ msg: 'memjet.call', method, args, jobId });
    const result = await client[method](...args);
    this._recordRealCall(method, true, 'call succeeded');
    return result;
  }

  async _guardCommand(operation) {
    const diagnostics = await this._buildDiagnostics();
    const op = diagnostics.operations?.[operation] || { allowed: false, reason: 'operation_not_defined' };
    if (!op.allowed) {
      throw new AdapterCapabilityError(`Operation ${operation} is blocked: ${op.reason}`, diagnostics);
    }
    return diagnostics;
  }

  async clearQueue({ jobId }) {
    await this._guardCommand('clearQueue');
    return this._call('clearJobQueue', [], jobId);
  }

  async initialiseEngine({ jobId }) {
    await this._guardCommand('initialiseEngine');
    return this._call('initialiseEngine', [], jobId);
  }

  async shutdownEngine({ jobId }) {
    await this._guardCommand('shutdownEngine');
    return this._call('shutdownEngine', [], jobId);
  }

  async startServicing({ level = 'light', jobId }) {
    await this._guardCommand('startServicing');
    return this._call('startServicing', [String(level)], jobId);
  }

  async startPriming({ jobId }) {
    await this._guardCommand('startPriming');
    return this._call('startPriming', [], jobId);
  }

  async startDepriming({ jobId }) {
    await this._guardCommand('startDepriming');
    return this._call('startDepriming', [], jobId);
  }

  async replaceWipers({ jobId }) {
    await this._guardCommand('replaceWipers');
    return this._call('replaceWipers', [], jobId);
  }

  async startMovingPrintheads({ printUnits = [], position = 'raised', jobId }) {
    await this._guardCommand('startMovingPrintheads');
    return this._call('startMovingPrintheads', [{ printUnits, position: String(position) }], jobId);
  }

  async pausePrinting({ targetPage = null, jobId }) {
    await this._guardCommand('pausePrinting');
    return this._call('pausePrinting', [targetPage == null ? null : Number(targetPage)], jobId);
  }

  async submitJobData({ jobId, artifactPath }) {
    if (!artifactPath) {
      throw new Error('No job artifact provided. Upload/ingest a test file first (POST /api/jobs/ingest).');
    }
    if (!fs.existsSync(artifactPath)) {
      throw new Error(`Job artifact not found at ${artifactPath}`);
    }

    await this._guardCommand('submitJobData');

    // Keep guarded until full JSL/raster path is complete.
    return this._call('submitJobData', [{ jobId, artifactPath }], jobId);
  }

  async prepareToPrint({ jobId, intendedSpeedIps }) {
    await this._guardCommand('prepareToPrint');
    return this._call('prepareToPrint', [Number(intendedSpeedIps || this.config.defaultIps || 15)], jobId);
  }

  async startPrinting({ jobId }) {
    const diagnostics = await this._buildDiagnostics();
    if (diagnostics?.gates?.dryRunRealSequence) {
      this.logger.info({ msg: 'memjet.call.simulated', method: 'startPrinting', jobId, reason: 'dry-run enabled' });
      return { ok: true, simulated: true, reason: 'RIP_BRIDGE_REAL_DRY_RUN=true' };
    }

    const op = diagnostics.operations?.startPrinting;
    if (!op?.allowed) {
      throw new AdapterCapabilityError(`Operation startPrinting is blocked: ${op?.reason || 'not allowed'}`, diagnostics);
    }

    return this._call('startPrinting', [], jobId);
  }

  async finishPrinting({ jobId }) {
    await this._guardCommand('finishPrinting');
    return this._call('finishPrinting', [], jobId);
  }

  async cancelJob({ jobId }) {
    const client = await this._ensureClient();
    if (typeof client.cancelJob !== 'function') return { ok: true, skipped: true };
    return this._call('cancelJob', [jobId], jobId);
  }
}

class StubMemjetAdapter extends MemjetAdapter {
  constructor({ logger, config }) {
    super();
    this.logger = logger;
    this.config = config;
  }

  async checkConnectivity() {
    return {
      ok: true,
      connected: true,
      degraded: false,
      mode: 'stub',
      protocol: this.config.protocol,
      diagnostics: {
        mode: 'stub',
        gates: {
          enableRealCommands: false,
          enableRealStartPrint: false,
          dryRunRealSequence: true
        },
        operations: {
          statusQuery: { allowed: true, reason: null }
        },
        note: 'Simulated adapter. No real Memjet control/data plane calls are made.'
      },
      productInfo: null
    };
  }

  async preflightFirstPrint() {
    return {
      passed: true,
      dryRun: true,
      checks: [{ id: 'stub', passed: true, required: true, detail: 'Stub mode always simulated' }],
      diagnostics: (await this.checkConnectivity()).diagnostics
    };
  }

  async clearQueue() { return { ok: true, simulated: true }; }
  async initialiseEngine() { return { ok: true, simulated: true }; }
  async shutdownEngine() { return { ok: true, simulated: true }; }
  async startServicing({ level = 'light', jobId }) { return { ok: true, level, jobId, mode: 'stub', simulated: true }; }
  async startPriming({ jobId }) { return { ok: true, jobId, mode: 'stub', simulated: true }; }
  async startDepriming({ jobId }) { return { ok: true, jobId, mode: 'stub', simulated: true }; }
  async replaceWipers({ jobId }) { return { ok: true, jobId, mode: 'stub', simulated: true }; }
  async startMovingPrintheads({ printUnits = [], position = 'raised', jobId }) {
    return { ok: true, printUnits, position, jobId, mode: 'stub', simulated: true };
  }
  async pausePrinting({ targetPage = null, jobId }) { return { ok: true, targetPage, jobId, mode: 'stub', simulated: true }; }
  async submitJobData({ jobId }) { return { ok: true, jobId, mode: 'stub', simulated: true }; }
  async prepareToPrint({ jobId }) { return { ok: true, jobId, mode: 'stub', simulated: true }; }
  async startPrinting({ jobId }) { return { ok: true, jobId, mode: 'stub', simulated: true }; }
  async finishPrinting({ jobId }) { return { ok: true, jobId, mode: 'stub', simulated: true }; }
  async cancelJob({ jobId }) { return { ok: true, jobId, simulated: true }; }
}

function createMemjetAdapter({ logger, config }) {
  if (config.mode === 'stub') return new StubMemjetAdapter({ logger, config });
  return new ThriftMemjetAdapter({ logger, config });
}

module.exports = { MemjetAdapter, StubMemjetAdapter, ThriftMemjetAdapter, AdapterCapabilityError, createMemjetAdapter, checkTcp };
