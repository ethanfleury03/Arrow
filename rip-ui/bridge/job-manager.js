const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AdapterCapabilityError } = require('./memjet-adapter');
const { SqliteStore } = require('./storage');

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
  constructor({ adapter, logger, emit, dataDir, store }) {
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

    // Initialize SQLite store
    if (store) {
      this.store = store;
    } else {
      const dbPath = path.join(this.dataDir, 'rip.db');
      this.store = new SqliteStore({ dbPath, logger });
      this.store.migrate();
    }

    // Load existing jobs from DB
    this._loadJobsFromStore();
  }

  _loadJobsFromStore() {
    try {
      const jobs = this.store.getAllJobs();
      for (const job of jobs) {
        this.jobs.set(job.jobId, job);
        if (job.state === JOB_STATES.QUEUED || job.state === JOB_STATES.PREPARING || job.state === JOB_STATES.PRINTING) {
          if (!this.queue.includes(job.jobId)) {
            this.queue.push(job.jobId);
          }
        }
      }
      this.logger.info({ msg: 'jobManager.loadedJobs', count: jobs.length, queued: this.queue.length });
    } catch (error) {
      this.logger.error({ msg: 'jobManager.loadJobsFailed', error: error.message });
    }
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

  _sanitizeFileName(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const basename = path.basename(raw);
    const sanitized = basename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
    if (!sanitized || sanitized === '.' || sanitized === '..') return null;
    return sanitized;
  }

  _safeArtifactPath(fileName) {
    const resolved = path.resolve(this.artifactsDir, fileName);
    const normalizedDir = path.resolve(this.artifactsDir) + path.sep;
    if (!resolved.startsWith(normalizedDir) && resolved !== path.resolve(this.artifactsDir, fileName)) {
      throw new Error(`Artifact path escapes artifacts directory: ${fileName}`);
    }
    if (!resolved.startsWith(path.resolve(this.artifactsDir))) {
      throw new Error(`Artifact path escapes artifacts directory: ${fileName}`);
    }
    return resolved;
  }

  ingestJob(payload = {}) {
    if (!payload.filePath && !payload.contentBase64) {
      throw new Error('Provide either filePath or contentBase64 for ingest');
    }

    let artifactPath = payload.filePath;
    let fileName = this._sanitizeFileName(payload.fileName)
      || (artifactPath ? this._sanitizeFileName(path.basename(artifactPath)) : null);

    if (payload.contentBase64) {
      const safeName = fileName || `artifact-${Date.now()}.bin`;
      artifactPath = this._safeArtifactPath(safeName);
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
    this.store.updateJobIngest(job.jobId, job.ingest);
    return job;
  }

  persistJob(job) {
    // Write to both SQLite and JSON file for backward compatibility
    try {
      const existing = this.store.getJob(job.jobId);
      if (existing) {
        this.store.updateJob(job);
      } else {
        this.store.createJob(job);
      }
    } catch (error) {
      this.logger.error({ msg: 'job.persist.sqliteFailed', jobId: job.jobId, error: error.message });
    }

    // Keep JSON backup for backward compatibility
    try {
      const out = path.join(this.jobsDir, `${job.jobId}.json`);
      fs.writeFileSync(out, JSON.stringify(job, null, 2));
    } catch (error) {
      this.logger.error({ msg: 'job.persist.jsonFailed', jobId: job.jobId, error: error.message });
    }
  }

  getJob(jobId) { return this.jobs.get(jobId) || null; }
  getQueue() { return this.queue.map(id => this.jobs.get(id)).filter(Boolean); }

  transition(job, nextState, extra = {}) {
    const prevState = job.state;
    job.state = nextState;
    job.updatedAt = new Date().toISOString();
    job.history.push({ at: job.updatedAt, state: nextState, ...extra });
    this.emit('job.updated', { jobId: job.jobId, runId: job.runId, state: job.state, extra });
    this.logger.info({ msg: 'job.transition', jobId: job.jobId, runId: job.runId, from: prevState, to: nextState, extra });
    this.persistJob(job);

    // Record job event in DB
    try {
      this.store.recordJobEvent(job.jobId, job.runId, nextState, { from: prevState, ...extra });
    } catch (error) {
      this.logger.error({ msg: 'job.event.recordFailed', jobId: job.jobId, error: error.message });
    }
  }

  async sendJob(jobId, { copies = 1 } = {}) {
    const job = this.getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);

    // Idempotency: prevent concurrent sends of the same job
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
      this.emit('job.send.step', { jobId: job.jobId, runId: job.runId, step: 'submitJobData' });
      const submitResult = await this.adapter.submitJobData({ jobId: job.jobId, copies: job.copies, artifactPath: job.artifactPath });

      if (submitResult?.lifecycleHandled) {
        this.emit('job.send.step', {
          jobId: job.jobId,
          runId: job.runId,
          step: 'lifecycleHandledBySubmit',
          mode: submitResult?.copiesExecutionMode || 'single'
        });
      } else {
        this.emit('job.send.step', { jobId: job.jobId, runId: job.runId, step: 'prepareToPrint' });
        await this.adapter.prepareToPrint({ jobId: job.jobId, copies: job.copies });
        this.transition(job, JOB_STATES.PRINTING);
        this.emit('job.send.step', { jobId: job.jobId, runId: job.runId, step: 'startPrinting' });
        await this.adapter.startPrinting({ jobId: job.jobId, copies: job.copies });
        this.emit('job.send.step', { jobId: job.jobId, runId: job.runId, step: 'finishPrinting' });
        await this.adapter.finishPrinting({ jobId: job.jobId });
      }
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

  // Expose store for external access (commands, audit, etc.)
  getStore() {
    return this.store;
  }
}

module.exports = { JobManager, JOB_STATES };
