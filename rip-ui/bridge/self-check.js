#!/usr/bin/env node
/**
 * Bridge Self-Check Script
 *
 * Runs SSH auth + getStatus parse check without starting the full bridge server.
 * Uses the same config resolution path as bridge:start (loadBridgeConfig + buildSshSettings).
 * Exits 0 on success, 1 on failure (fast fail).
 *
 * Usage:
 *   npm run bridge:check
 *   node bridge/self-check.js
 */

const { loadBridgeConfig } = require('./config');
const { buildSshSettings, runSshSelfCheck, isSshConfigured } = require('./real-client-factory.local');

// Simple logger that writes to stderr
const logger = {
  info: (payload) => console.error(`[INFO] ${payload.msg}`, JSON.stringify(payload, null, 2)),
  error: (payload) => console.error(`[ERROR] ${payload.msg}`, JSON.stringify(payload, null, 2)),
  warn: (payload) => console.error(`[WARN] ${payload.msg}`, JSON.stringify(payload, null, 2)),
  debug: (payload) => console.error(`[DEBUG] ${payload.msg}`, JSON.stringify(payload, null, 2))
};

async function main() {
  const start = Date.now();

  // Load config using same path as bridge server
  const config = loadBridgeConfig(process.env);

  // Check backend mode - skip if local backend
  const backend = String(process.env.MEMJET_REAL_BACKEND || 'ssh').trim().toLowerCase();
  if (backend === 'local') {
    console.error('[SKIP] Self-check skipped for local backend (MEMJET_REAL_BACKEND=local)');
    process.exit(0);
  }

  // Build SSH settings using same resolution as bridge server
  const settings = buildSshSettings({
    host: config.memjet.host,
    commandPort: config.memjet.commandPort,
    eventPort: config.memjet.eventPort,
    dataPort: config.memjet.dataPort
  });

  // Check if SSH is fully configured using the same logic as the bridge server
  // buildSshSettings provides defaults for cmdTemplate, so we only need host and user
  const sshHost = settings.sshHost;
  const sshUser = settings.sshUser;

  if (!sshHost || !sshUser) {
    const missing = [
      !sshHost ? 'MEMJET_SSH_HOST (or ARROW_PES_HOST, MEMJET_TARGET_HOST, MEMJET_HOST)' : null,
      !sshUser ? 'MEMJET_SSH_USER (or RIP_SSH_USER)' : null
    ].filter(Boolean);
    console.error(`[SKIP] SSH not fully configured (missing: ${missing.join(', ')})`);
    console.error('[HINT] Set the required environment variables to run the self-check');
    process.exit(0); // Exit 0 when skipped due to config
  }

  // If buildSshSettings reports missing required fields, still attempt the check
  // since cmdTemplate has a default value. Only skip if host or user is missing.

  console.error(`[CHECK] Starting bridge self-check...`);
  console.error(`[CHECK] SSH target: ${sshUser}@${sshHost}`);

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
