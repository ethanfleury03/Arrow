#!/usr/bin/env node
/**
 * Bridge Self-Check Script
 *
 * Runs SSH auth + getStatus parse check without starting the full bridge server.
 * Exits 0 on success, 1 on failure (fast fail).
 *
 * Usage:
 *   npm run bridge:check
 *   node bridge/self-check.js
 */

const { buildSshSettings, runSshSelfCheck } = require('./real-client-factory.local');
const { loadPesDefaults } = require('./pes-defaults');

// Simple logger that writes to stderr
const logger = {
  info: (payload) => console.error(`[INFO] ${payload.msg}`, JSON.stringify(payload, null, 2)),
  error: (payload) => console.error(`[ERROR] ${payload.msg}`, JSON.stringify(payload, null, 2)),
  warn: (payload) => console.error(`[WARN] ${payload.msg}`, JSON.stringify(payload, null, 2)),
  debug: (payload) => console.error(`[DEBUG] ${payload.msg}`, JSON.stringify(payload, null, 2))
};

async function main() {
  const start = Date.now();

  // Check if SSH is configured
  const sshHost = String(process.env.MEMJET_SSH_HOST || process.env.RIP_SSH_HOST || '').trim();
  const sshUser = String(process.env.MEMJET_SSH_USER || process.env.RIP_SSH_USER || '').trim();
  const cmdTemplate = String(process.env.MEMJET_SSH_REMOTE_CMD_TEMPLATE || '').trim();

  if (!sshHost || !sshUser || !cmdTemplate) {
    const missing = [
      !sshHost ? 'MEMJET_SSH_HOST' : null,
      !sshUser ? 'MEMJET_SSH_USER' : null,
      !cmdTemplate ? 'MEMJET_SSH_REMOTE_CMD_TEMPLATE' : null
    ].filter(Boolean);
    console.error(`[SKIP] SSH not fully configured (missing: ${missing.join(', ')})`);
    console.error('[HINT] Set the required environment variables to run the self-check');
    process.exit(0); // Exit 0 when skipped due to config
  }

  console.error(`[CHECK] Starting bridge self-check...`);
  console.error(`[CHECK] SSH target: ${sshUser}@${sshHost}`);

  const defaults = loadPesDefaults(process.env);
  const settings = buildSshSettings({
    host: defaults.host,
    commandPort: defaults.commandPort,
    eventPort: defaults.eventPort,
    dataPort: defaults.dataPort
  });

  const result = await runSshSelfCheck(settings, logger);

  if (!result.ok) {
    console.error(`\n[FAIL] Bridge self-check failed after ${Date.now() - start}ms`);
    console.error(`[FAIL] Category: ${result.category}`);
    console.error(`[FAIL] Reason: ${result.reason}`);
    console.error(`\n[ACTION] Fix the issue above and re-run: npm run bridge:check`);
    process.exit(1);
  }

  console.log(`[OK] Bridge self-check passed in ${Date.now() - start}ms`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[ERROR] Unexpected error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
