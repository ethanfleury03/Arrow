const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AdapterCapabilityError } = require('./memjet-adapter');

function isIgnorableInitialiseError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('engine must be off');
}

const JOB_STATES = {
  DRAFT: 'draft',
  VALIDATED: 'validated',
  QUEUED: 'queued',
  PREPARING: 'preparing',
  PRINTING: 'printing',
  COMPLETED: 'completed',
  ERROR: 'error',
  CANCELLED: 'cancelled'
};

class JobManager {
  constructor({ adapter, logger, emit, dataDir }) {
    this.adapter = adapter;
    this.logger = logger;
    this.emit = emit;
    this.jobs = new Map();
    this.queue = [];
    this.activeSends = new Map();
    this.dataDir = dataDir || path.join(process.cwd(), 'bridge-data');
    this.jobsDir = path.join(this.dataDir, 'jobs');
    this.artifactsDir = path.join(this.dataDir, 'artifacts');
    fs.mkdirSync(this.jobsDir, { recursive: true });
    fs.mkdirSync(this.artifactsDir, { recursive: true });
    this.deviceState = { engine: 'idle', connected: false, lastUpdate: new Date().toISOString() };
  }

  createJob(payload = {}) {
    const id = payload.jobId || randomUUID();
    const copies = Number(payload.copies || 1);

    const job = {
      jobId: id,
      runId: null,
      state: JOB_STATES.DRAFT,
      copies: Number.isFinite(copies) && copies > 0 ? copies : 1,
      fileName: payload.fileName || null,
      artifactPath: payload.artifactPath || null,
      source: payload.source || 'api',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: []
    };
    this.jobs.set(id, job);
    this.transition(job, JOB_STATES.VALIDATED, { reason: 'created' });
    this.persistJob(job);
    return job;
  }

  ingestJob(payload = {}) {
    if (!payload.filePath && !payload.contentBase64) {
      throw new Error('Provide either filePath or contentBase64 for ingest');
    }

    let artifactPath = payload.filePath;
    let fileName = payload.fileName || (artifactPath ? path.basename(artifactPath) : null);

    if (payload.contentBase64) {
      const safeName = fileName || `artifact-${Date.now()}.bin`;
      artifactPath = path.join(this.artifactsDir, safeName);
      fs.writeFileSync(artifactPath, Buffer.from(payload.contentBase64, 'base64'));
      fileName = safeName;
    }

    if (!artifactPath || !fs.existsSync(artifactPath)) {
      throw new Error(`Ingest artifact does not exist: ${artifactPath || 'unknown path'}`);
    }

    const stats = fs.statSync(artifactPath);
    const job = this.createJob({
      jobId: payload.jobId,
      copies: payload.copies,
      fileName,
      artifactPath,
      source: 'ingest'
    });

    job.ingest = {
      at: new Date().toISOString(),
      artifactPath,
      bytes: stats.size,
      mimeType: payload.mimeType || 'application/octet-stream'
    };
    this.persistJob(job);
    return job;
  }

  persistJob(job) {
    const out = path.join(this.jobsDir, `${job.jobId}.json`);
    fs.writeFileSync(out, JSON.stringify(job, null, 2));
  }

  getJob(jobId) { return this.jobs.get(jobId) || null; }
  getQueue() { return this.queue.map(id => this.jobs.get(id)).filter(Boolean); }

  transition(job, nextState, extra = {}) {
    job.state = nextState;
    job.updatedAt = new Date().toISOString();
    job.history.push({ at: job.updatedAt, state: nextState, ...extra });
    this.emit('job.updated', { jobId: job.jobId, runId: job.runId, state: job.state, extra });
    this.logger.info({ msg: 'job.transition', jobId: job.jobId, runId: job.runId, state: nextState, extra });
    this.persistJob(job);
  }

  async sendJob(jobId, { copies = 1 } = {}) {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    if (this.activeSends.has(jobId)) {
      return this.activeSends.get(jobId);
    }

    const task = this._sendJobInternal(job, { copies }).finally(() => {
      this.activeSends.delete(jobId);
    });

    this.activeSends.set(jobId, task);
    return task;
  }

  async _sendJobInternal(job, { copies = 1 } = {}) {
    job.runId = randomUUID();
    job.copies = Number(copies || job.copies || 1);
    if (job.state === JOB_STATES.DRAFT) this.transition(job, JOB_STATES.VALIDATED, { reason: 'send' });
    this.transition(job, JOB_STATES.QUEUED, { copies: job.copies });
    if (!this.queue.includes(job.jobId)) this.queue.push(job.jobId);

    try {
      const connectivity = await this.adapter.checkConnectivity();
      if (!connectivity?.ok) {
        const reason = connectivity?.diagnostics || connectivity || null;
        throw new AdapterCapabilityError(
          'Real Memjet adapter unavailable. Check /api/device/status diagnostics and configure thrift client factory + reachable host.',
          reason
        );
      }

      const preflight = await this.adapter.preflightFirstPrint({
        requireStartPrint: !Boolean(connectivity?.diagnostics?.gates?.dryRunRealSequence)
      });
      if (!preflight?.passed) {
        const failed = (preflight?.checks || []).filter(c => c.required && !c.passed).map(c => `${c.id}: ${c.detail}`);
        throw new AdapterCapabilityError(
          `Preflight failed. ${failed.join('; ')}`,
          { preflight, diagnostics: preflight?.diagnostics || null }
        );
      }

      this.emit('job.send.step', {
        jobId: job.jobId,
        runId: job.runId,
        step: 'preflight',
        simulated: Boolean(preflight?.dryRun)
      });

      this.emit('job.send.step', { jobId: job.jobId, runId: job.runId, step: 'clearQueue' });
      await this.adapter.clearQueue({ jobId: job.jobId });
      this.emit('job.send.step', { jobId: job.jobId, runId: job.runId, step: 'initialiseEngine' });
      try {
        await this.adapter.initialiseEngine({ jobId: job.jobId });
      } catch (error) {
        if (!isIgnorableInitialiseError(error)) throw error;
        this.emit('job.send.step', {
          jobId: job.jobId,
          runId: job.runId,
          step: 'initialiseEngine:skipped',
          reason: 'engine_already_on'
        });
      }
      this.transition(job, JOB_STATES.PREPARING);
      this.emit('job.send.step', { jobId: job.jobId, runId: job.runId, step: 'prepareToPrint' });
      await this.adapter.prepareToPrint({ jobId: job.jobId, copies: job.copies });
      this.emit('job.send.step', { jobId: job.jobId, runId: job.runId, step: 'submitJobData' });
      await this.adapter.submitJobData({ jobId: job.jobId, copies: job.copies, artifactPath: job.artifactPath });
      this.transition(job, JOB_STATES.PRINTING);
      this.emit('job.send.step', { jobId: job.jobId, runId: job.runId, step: 'startPrinting' });
      await this.adapter.startPrinting({ jobId: job.jobId, copies: job.copies });
      this.emit('job.send.step', { jobId: job.jobId, runId: job.runId, step: 'finishPrinting' });
      await this.adapter.finishPrinting({ jobId: job.jobId });
      this.transition(job, JOB_STATES.COMPLETED);
      this.queue = this.queue.filter(id => id !== job.jobId);
      return job;
    } catch (error) {
      this.transition(job, JOB_STATES.ERROR, {
        error: error.message,
        code: error.code || null,
        diagnostics: error.diagnostics || null
      });
      this.queue = this.queue.filter(id => id !== job.jobId);
      throw error;
    }
  }

  async cancelJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    await this.adapter.cancelJob({ jobId });
    this.transition(job, JOB_STATES.CANCELLED);
    this.queue = this.queue.filter(id => id !== jobId);
    return job;
  }

  async refreshDeviceStatus() {
    const status = await this.adapter.checkConnectivity();
    this.deviceState = {
      engine: this.queue.length > 0 ? 'busy' : 'idle',
      connected: Boolean(status?.ok),
      degraded: !Boolean(status?.ok),
      details: status,
      lastUpdate: new Date().toISOString()
    };
    this.emit('device.updated', this.deviceState);
    return this.deviceState;
  }
}

module.exports = { JobManager, JOB_STATES };
