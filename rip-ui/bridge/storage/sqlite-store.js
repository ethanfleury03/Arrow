const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        run_id TEXT,
        state TEXT NOT NULL,
        copies INTEGER DEFAULT 1,
        file_name TEXT,
        artifact_path TEXT,
        source TEXT DEFAULT 'api',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ingest_at TEXT,
        ingest_bytes INTEGER,
        ingest_mime_type TEXT,
        history_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
      CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at);

      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        run_id TEXT,
        state TEXT NOT NULL,
        at TEXT NOT NULL,
        extra_json TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON job_events(job_id);
      CREATE INDEX IF NOT EXISTS idx_job_events_at ON job_events(at);

      CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command TEXT NOT NULL,
        job_id TEXT,
        accepted BOOLEAN,
        result_json TEXT,
        error_json TEXT,
        at TEXT NOT NULL,
        duration_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_commands_at ON commands(at);
      CREATE INDEX IF NOT EXISTS idx_commands_job_id ON commands(job_id);

      CREATE TABLE IF NOT EXISTS device_status_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        engine_state TEXT,
        engine_state_raw_numeric INTEGER,
        engine_state_raw_label TEXT,
        queue_length INTEGER DEFAULT 0,
        connected BOOLEAN,
        degraded BOOLEAN,
        ink_levels_json TEXT,
        details_json TEXT,
        at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_device_status_at ON device_status_snapshots(at);

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        msg TEXT NOT NULL,
        meta_json TEXT,
        at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_at ON audit_log(at);
      CREATE INDEX IF NOT EXISTS idx_audit_log_level ON audit_log(level);

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `
  }
];

class SqliteStore {
  constructor(options = {}) {
    this.dbPath = options.dbPath || path.join(process.cwd(), 'bridge-data', 'rip.db');
    this.logger = options.logger || { info: () => {}, error: () => {}, debug: () => {} };
    this.db = null;
  }

  open() {
    if (this.db) return this.db;
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.logger.info({ msg: 'sqlite.open', path: this.dbPath });
    return this.db;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.logger.info({ msg: 'sqlite.close' });
    }
  }

  getVersion() {
    try {
      const row = this.db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get();
      return row ? row.version : 0;
    } catch {
      return 0;
    }
  }

  migrate() {
    this.open();
    const currentVersion = this.getVersion();
    this.logger.info({ msg: 'sqlite.migrate.start', currentVersion, targetVersion: MIGRATIONS.length });

    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        this.logger.info({ msg: 'sqlite.migrate.apply', version: migration.version, name: migration.name });
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
          migration.version,
          new Date().toISOString()
        );
      }
    }

    this.logger.info({ msg: 'sqlite.migrate.complete', version: this.getVersion() });
    return this.getVersion();
  }

  // Jobs
  createJob(job) {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (job_id, run_id, state, copies, file_name, artifact_path, source, created_at, updated_at, history_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.jobId,
      job.runId || null,
      job.state,
      job.copies,
      job.fileName || null,
      job.artifactPath || null,
      job.source || 'api',
      job.createdAt,
      job.updatedAt,
      JSON.stringify(job.history || [])
    );
    return this.getJob(job.jobId);
  }

  getJob(jobId) {
    const row = this.db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId);
    if (!row) return null;
    return this._hydrateJob(row);
  }

  updateJob(job) {
    const stmt = this.db.prepare(`
      UPDATE jobs SET
        run_id = ?,
        state = ?,
        copies = ?,
        file_name = ?,
        artifact_path = ?,
        updated_at = ?,
        history_json = ?
      WHERE job_id = ?
    `);
    stmt.run(
      job.runId || null,
      job.state,
      job.copies,
      job.fileName || null,
      job.artifactPath || null,
      job.updatedAt,
      JSON.stringify(job.history || []),
      job.jobId
    );
    return this.getJob(job.jobId);
  }

  updateJobIngest(jobId, ingest) {
    const stmt = this.db.prepare(`
      UPDATE jobs SET
        ingest_at = ?,
        ingest_bytes = ?,
        ingest_mime_type = ?
      WHERE job_id = ?
    `);
    stmt.run(ingest.at, ingest.bytes, ingest.mimeType, jobId);
  }

  getAllJobs() {
    const rows = this.db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
    return rows.map(r => this._hydrateJob(r));
  }

  getJobsByState(state) {
    const rows = this.db.prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC').all(state);
    return rows.map(r => this._hydrateJob(r));
  }

  _hydrateJob(row) {
    return {
      jobId: row.job_id,
      runId: row.run_id,
      state: row.state,
      copies: row.copies,
      fileName: row.file_name,
      artifactPath: row.artifact_path,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      history: row.history_json ? JSON.parse(row.history_json) : [],
      ingest: row.ingest_at ? {
        at: row.ingest_at,
        bytes: row.ingest_bytes,
        mimeType: row.ingest_mime_type
      } : undefined
    };
  }

  // Job Events
  recordJobEvent(jobId, runId, state, extra = {}) {
    const stmt = this.db.prepare(`
      INSERT INTO job_events (job_id, run_id, state, at, extra_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(jobId, runId || null, state, new Date().toISOString(), JSON.stringify(extra));
  }

  getJobEvents(jobId) {
    const rows = this.db.prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY at ASC').all(jobId);
    return rows.map(r => ({
      id: r.id,
      jobId: r.job_id,
      runId: r.run_id,
      state: r.state,
      at: r.at,
      extra: r.extra_json ? JSON.parse(r.extra_json) : {}
    }));
  }

  // Commands
  recordCommand({ command, jobId, accepted, result, error, durationMs }) {
    const stmt = this.db.prepare(`
      INSERT INTO commands (command, job_id, accepted, result_json, error_json, at, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      command,
      jobId || null,
      accepted === undefined ? null : accepted ? 1 : 0,
      result ? JSON.stringify(result) : null,
      error ? JSON.stringify(error) : null,
      new Date().toISOString(),
      durationMs || null
    );
    return this.db.prepare('SELECT last_insert_rowid() as id').get().id;
  }

  getCommands(options = {}) {
    let sql = 'SELECT * FROM commands';
    const params = [];
    const where = [];

    if (options.jobId) {
      where.push('job_id = ?');
      params.push(options.jobId);
    }

    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => ({
      id: r.id,
      command: r.command,
      jobId: r.job_id,
      accepted: r.accepted === null ? null : Boolean(r.accepted),
      result: r.result_json ? JSON.parse(r.result_json) : null,
      error: r.error_json ? JSON.parse(r.error_json) : null,
      at: r.at,
      durationMs: r.duration_ms
    }));
  }

  // Device Status Snapshots
  recordDeviceStatus(status) {
    const stmt = this.db.prepare(`
      INSERT INTO device_status_snapshots
      (engine_state, engine_state_raw_numeric, engine_state_raw_label, queue_length, connected, degraded, ink_levels_json, details_json, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      status.engineState || null,
      status.engineStateRawNumeric || null,
      status.engineStateRawLabel || null,
      status.queueLength || 0,
      status.connected === undefined ? null : status.connected ? 1 : 0,
      status.degraded === undefined ? null : status.degraded ? 1 : 0,
      status.inkLevels ? JSON.stringify(status.inkLevels) : null,
      status.details ? JSON.stringify(status.details) : null,
      status.timestamp || new Date().toISOString()
    );
    return this.db.prepare('SELECT last_insert_rowid() as id').get().id;
  }

  getLatestDeviceStatus() {
    const row = this.db.prepare('SELECT * FROM device_status_snapshots ORDER BY at DESC LIMIT 1').get();
    if (!row) return null;
    return this._hydrateDeviceStatus(row);
  }

  getDeviceStatusHistory(options = {}) {
    let sql = 'SELECT * FROM device_status_snapshots';
    const params = [];

    if (options.since) {
      sql += ' WHERE at >= ?';
      params.push(options.since);
    }

    sql += ' ORDER BY at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => this._hydrateDeviceStatus(r));
  }

  _hydrateDeviceStatus(row) {
    return {
      id: row.id,
      engineState: row.engine_state,
      engineStateRawNumeric: row.engine_state_raw_numeric,
      engineStateRawLabel: row.engine_state_raw_label,
      queueLength: row.queue_length,
      connected: row.connected === null ? null : Boolean(row.connected),
      degraded: row.degraded === null ? null : Boolean(row.degraded),
      inkLevels: row.ink_levels_json ? JSON.parse(row.ink_levels_json) : null,
      details: row.details_json ? JSON.parse(row.details_json) : null,
      timestamp: row.at
    };
  }

  // Audit Log
  appendAudit(level, msg, meta = {}) {
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (level, msg, meta_json, at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(level, msg, JSON.stringify(meta), new Date().toISOString());
  }

  getAuditLog(options = {}) {
    let sql = 'SELECT * FROM audit_log';
    const params = [];
    const where = [];

    if (options.level) {
      where.push('level = ?');
      params.push(options.level);
    }

    if (options.since) {
      where.push('at >= ?');
      params.push(options.since);
    }

    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY at DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => ({
      id: r.id,
      level: r.level,
      msg: r.msg,
      meta: r.meta_json ? JSON.parse(r.meta_json) : {},
      at: r.at
    }));
  }

  // Utilities
  deleteOldRecords(table, olderThanDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const cutoffIso = cutoff.toISOString();
    const stmt = this.db.prepare(`DELETE FROM ${table} WHERE at < ?`);
    const result = stmt.run(cutoffIso);
    return result.changes;
  }
}

module.exports = { SqliteStore, MIGRATIONS };
