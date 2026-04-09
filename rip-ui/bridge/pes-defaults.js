/**
 * Single source of truth for PES (Print Engine System) network defaults.
 *
 * Every JS component that needs a fallback PES host/port should import from
 * here rather than hardcoding values.  Environment variables always win; these
 * constants are the last-resort fallbacks when nothing is configured.
 *
 * Canonical network layout (Kareela lab):
 *   PES host .............. 192.168.111.1
 *   Thrift command port ... 13001
 *   Event port ............ 9231
 *   Data port ............. 13001
 */

const DEFAULT_PES_HOST = '192.168.111.1';
const DEFAULT_COMMAND_PORT = 13001;
const DEFAULT_EVENT_PORT = 9231;
const DEFAULT_DATA_PORT = 13001;

// SSH defaults for remote Linux bridge host (pesctl execution)
const DEFAULT_SSH_HOST = '192.168.100.200';
const DEFAULT_SSH_USER = 'root';
const DEFAULT_SSH_PORT = 22;
const DEFAULT_SSH_REMOTE_CMD_TEMPLATE =
  '/usr/local/bin/pesctl --op {operation} --args-b64 {args_json_b64} --host {host} --command-port {commandPort} --event-port {eventPort} --data-port {dataPort}';

function loadPesDefaults(env = process.env) {
  return Object.freeze({
    host: String(
      env.ARROW_PES_HOST || env.MEMJET_TARGET_HOST || env.MEMJET_HOST || DEFAULT_PES_HOST
    ).trim(),
    commandPort: toPort(
      env.ARROW_PES_COMMAND_PORT || env.MEMJET_TARGET_COMMAND_PORT || env.MEMJET_COMMAND_PORT,
      DEFAULT_COMMAND_PORT
    ),
    eventPort: toPort(
      env.ARROW_PES_EVENT_PORT || env.MEMJET_TARGET_EVENT_PORT || env.MEMJET_EVENT_PORT,
      DEFAULT_EVENT_PORT
    ),
    dataPort: toPort(
      env.ARROW_PES_DATA_PORT || env.MEMJET_TARGET_DATA_PORT || env.MEMJET_DATA_PORT,
      DEFAULT_DATA_PORT
    ),
    sshHostKeyFingerprint: String(env.ARROW_PES_SSH_HOST_KEY || '').trim(),
    sshHost: String(
      env.ARROW_SSH_HOST || env.MEMJET_SSH_HOST || env.RIP_SSH_HOST || DEFAULT_SSH_HOST
    ).trim(),
    sshUser: String(
      env.ARROW_SSH_USER || env.MEMJET_SSH_USER || env.RIP_SSH_USER || DEFAULT_SSH_USER
    ).trim(),
    sshPort: toPort(
      env.ARROW_SSH_PORT || env.MEMJET_SSH_PORT || env.RIP_SSH_PORT,
      DEFAULT_SSH_PORT
    ),
    sshRemoteCmdTemplate: String(
      env.ARROW_SSH_REMOTE_CMD_TEMPLATE || env.MEMJET_SSH_REMOTE_CMD_TEMPLATE || DEFAULT_SSH_REMOTE_CMD_TEMPLATE
    ).trim()
  });
}

function toPort(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 65535 ? n : fallback;
}

module.exports = {
  DEFAULT_PES_HOST,
  DEFAULT_COMMAND_PORT,
  DEFAULT_EVENT_PORT,
  DEFAULT_DATA_PORT,
  DEFAULT_SSH_HOST,
  DEFAULT_SSH_USER,
  DEFAULT_SSH_PORT,
  DEFAULT_SSH_REMOTE_CMD_TEMPLATE,
  loadPesDefaults
};
