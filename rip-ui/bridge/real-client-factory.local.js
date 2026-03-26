/**
 * Local default real PES client factory entrypoint.
 *
 * Backends:
 * - local (default): local Python Thrift + local gborcat execution
 * - ssh: execute operations via remote Linux command wrapper over SSH
 *
 * Required export contract:
 *   module.exports.createClient = async ({ host, commandPort, eventPort, dataPort, protocol, transport, thrift, logger }) => ({
 *     getStatus?: async () => any,
 *     getProductInfo?: async () => any,
 *     clearJobQueue: async () => any,
 *     initialiseEngine: async () => any,
 *     shutdownEngine: async () => any,
 *     startServicing: async (level:'light'|'medium'|'heavy') => any,
 *     startPriming: async () => any,
 *     startDepriming: async () => any,
 *     replaceWipers: async () => any,
 *     startMovingPrintheads: async ({ printUnits?: number[], position:'capped'|'raised'|'print' }) => any,
 *     pausePrinting: async (targetPage:number|null) => any,
 *     prepareToPrint: async (ips:number) => any,
 *     submitJobData: async ({ jobId, artifactPath }) => any,
 *     startPrinting: async () => any,
 *     finishPrinting: async () => any,
 *     cancelJob?: async (jobId:string) => any
 *   })
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

const execFileAsync = promisify(execFile);

// Arrow production defaults (intentionally hardcoded for consistency).
const ARROW_PES = Object.freeze({
  host: '192.168.111.1',
  commandPort: 13001,
  eventPort: 9231,
  dataPort: 13001,
  sshHostKeyEd25519: 'ssh-ed25519 255 SHA256:Dt4YfNq2cxtaqz3ssSPh6RXw4rPVPzZoJ7cLkH2Tias'
});

function parseJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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
      if (['message', 'reason', 'note', 'status', 'resultrepr', 'output', 'rawstdout', 'rawstderr'].includes(keyLc)) {
        return hasSimulatedSignal(val, depth + 1);
      }
      return false;
    });
  }

  return false;
}

const PRINTHEAD_POSITION_TO_ENUM = Object.freeze({
  raised: 0,
  capped: 1,
  print: 2
});

function normalizePrintUnits(rawPrintUnits) {
  if (rawPrintUnits == null) return [];
  const values = Array.isArray(rawPrintUnits) ? rawPrintUnits : [rawPrintUnits];
  return [...new Set(
    values
      .map(v => Number(v))
      .filter(v => Number.isInteger(v) && v >= 1 && v <= 127)
  )].sort((a, b) => a - b);
}

function normalizePrintheadPositionEnum(rawPosition) {
  const key = String(rawPosition || 'raised').trim().toLowerCase();
  if (!(key in PRINTHEAD_POSITION_TO_ENUM)) {
    throw new Error(`Unsupported printhead position: ${rawPosition}`);
  }
  return PRINTHEAD_POSITION_TO_ENUM[key];
}

function workspaceRoot() {
  const configured = String(process.env.ARROW_ROOT || '').trim();
  if (configured) return path.resolve(configured);
  return path.resolve(__dirname, '..');
}

function buildPythonPaths() {
  const root = workspaceRoot();
  const candidates = [
    path.join(root, 'rip_consolidated_projects', 'development', 'pdl-source', 'kareela', 'py'),
    path.join(root, 'rip_consolidated_projects', 'development', 'pdl-source', 'PDL', 'MJ6.5.0-2.el7'),
    path.join(root, '..', 'rip_consolidated_projects', 'development', 'pdl-source', 'kareela', 'py'),
    path.join(root, '..', 'rip_consolidated_projects', 'development', 'pdl-source', 'PDL', 'MJ6.5.0-2.el7')
  ];
  return [...new Set(candidates.map(p => path.resolve(p)))];
}

function fileReadable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function normalizeJobId(input) {
  const raw = String(input || '').trim();
  const ascii = raw.replace(/[^\x20-\x7E]/g, '');

  if (/^[A-Za-z0-9]{32}$/.test(ascii)) {
    return { jobId: ascii, normalized: false, original: raw };
  }

  const sanitized = ascii.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const digest = crypto.createHash('sha256').update(sanitized || raw || Date.now().toString()).digest('hex');
  return { jobId: digest.slice(0, 32), normalized: true, original: raw };
}

function buildGborcatCommand({ host, dataPort, jobId, artifactPath }) {
  const envTool = process.env.MEMJET_GBORCAT_BIN || process.env.RIP_GBORCAT_BIN;
  const bundledWinTool = path.resolve(process.cwd(), 'runtime', 'bin', 'gborcat.exe');
  const tool = envTool
    || ((process.platform === 'win32' && fs.existsSync(bundledWinTool)) ? bundledWinTool : 'gborcat');
  const args = ['-h', String(host), '-c', '1', '-r', '1', '-j', String(jobId), '-v', String(artifactPath)];

  if (Number.isFinite(Number(dataPort)) && Number(dataPort) > 0 && String(process.env.MEMJET_GBORCAT_USE_PORT || '').trim() === '1') {
    args.splice(2, 0, '-p', String(Number(dataPort)));
  }

  return { tool, args };
}

function getSubmitMode() {
  // Default to memjet-rip so auto-send works out-of-the-box in Arrow monorepo.
  return String(process.env.MEMJET_SUBMIT_MODE || 'memjet-rip').trim().toLowerCase();
}

function buildMemjetRipCommand({ artifactPath, host, dataPort, copies = 1 }) {
  const repoRoot = path.resolve(process.cwd(), '..');
  const configured = process.env.MEMJET_RIP_BIN || process.env.MEMJET_SUBMITTER_BIN || process.env.RIP_MEMJET_RIP_BIN;
  const defaultWinBin = path.resolve(repoRoot, 'rip-core', 'src', 'build', 'Release', 'memjet-rip.exe');
  const tool = configured || ((process.platform === 'win32' && fs.existsSync(defaultWinBin)) ? defaultWinBin : 'memjet-rip.exe');
  const ripCoreRoot = process.env.MEMJET_RIP_ROOT || path.resolve(repoRoot, 'rip-core');
  const defaultTempDir = path.resolve(ripCoreRoot, 'temp');
  const tempDir = process.env.MEMJET_RIP_TEMP_DIR || process.env.MEMJET_SUBMIT_TEMP_DIR || defaultTempDir;
  const jslConfigPath = process.env.JSL_CONFIG_PATH || path.resolve(ripCoreRoot, 'jsl-sdk', 'JslConfigs.xml');
  const effectiveHost = ARROW_PES.host;
  const effectiveDataPort = ARROW_PES.dataPort;
  const args = [String(artifactPath), '--pes-ip', String(effectiveHost), '--pes-port', String(effectiveDataPort), '-v'];
  return {
    tool,
    args,
    tempDir,
    ripCoreRoot,
    jslConfigPath,
    copies: Number.isFinite(Number(copies)) && Number(copies) > 0 ? Math.floor(Number(copies)) : 1
  };
}

function isPrintedButTerminalAckTimedOut(stdout = '', stderr = '') {
  const out = String(stdout || '');
  const err = String(stderr || '');
  const combined = `${out}\n${err}`;

  const hadDataSubmit = /add_page_submit[\s\S]*"result":"OK"/.test(combined)
    || /JSL_TRANSFER_COMPLETED/.test(combined)
    || /phase_transition[\s\S]*"state_after":"TX_DONE"/.test(combined);
  const hadStart = /guarded_start[\s\S]*"result":"OK"/.test(combined)
    || /start_print_postcheck[\s\S]*"result":"OK"/.test(combined);
  const hadBenignSessionCloseRace = /Print session must be active/i.test(combined)
    || /cleanup_done[\s\S]*prepareToPrint blocked: engine not PRIMED_IDLE\/PRINT_READY/.test(combined);
  const hadTerminalTimeout = /TERMINAL_PRINT_ACK_TIMEOUT/.test(combined)
    || /Timed out waiting for terminal print completion state/i.test(combined)
    || /WAIT_TERMINAL_STATE/.test(combined)
    || /SESSION_COMPLETE_TIMEOUT/.test(combined)
    || /wait_session_complete_after_start_timeout/.test(combined)
    || /active_seen=true,\s*last=PRE_JOB/.test(combined);

  return hadDataSubmit && ((hadStart && hadTerminalTimeout) || hadBenignSessionCloseRace);
}

async function runMemjetRipSubmit({ artifactPath, host, dataPort, copies = 1, logger, requestedJobId = null, normalizedJobId = null, normalizedFlag = false }) {
  const plan = buildMemjetRipCommand({ artifactPath, host, dataPort, copies });

  if (process.platform === 'win32') {
    try {
      fs.mkdirSync(plan.tempDir, { recursive: true });
    } catch {
      // ignore; exec will surface errors if path is not usable
    }
  }

  if (logger?.warn) {
    logger.warn({
      msg: 'memjet.submitJobData.memjet_rip',
      tool: plan.tool,
      args: plan.args,
      tempDir: plan.tempDir,
      jslConfigPath: plan.jslConfigPath,
      ripCoreRoot: plan.ripCoreRoot,
      copies: plan.copies,
      host,
      dataPort
    });
  }

  // Default OFF: let Memjet pipeline handle multi-copy in one continuous run.
  // Set MEMJET_FORCE_COPY_LOOP=1 only for fallback troubleshooting.
  const forceCopyLoop = String(process.env.MEMJET_FORCE_COPY_LOOP || '0').trim() !== '0';
  const perRunCopies = (forceCopyLoop && plan.copies > 1) ? 1 : plan.copies;
  const runs = (forceCopyLoop && plan.copies > 1) ? plan.copies : 1;
  const loopGapMs = Number(process.env.MEMJET_COPY_LOOP_GAP_MS || 1500);
  // Keep degraded gaps short by default so multi-copy jobs continue promptly.
  // Can still be overridden via env when needed.
  const degradedGapMs = Number(process.env.MEMJET_COPY_LOOP_DEGRADED_GAP_MS || 5000);

  let lastStdout = '';
  let lastStderr = '';

  let degradedCount = 0;

  for (let i = 0; i < runs; i += 1) {
    let degradedThisRun = false;
    if (logger?.info && runs > 1) {
      logger.info({ msg: 'memjet.submitJobData.copy_loop', run: i + 1, runs, requestedCopies: plan.copies });
    }

    try {
      const { stdout, stderr } = await execFileAsync(plan.tool, plan.args, {
        cwd: plan.ripCoreRoot,
        timeout: Number(process.env.MEMJET_SUBMIT_TIMEOUT_MS || 180000),
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          TEMP: plan.tempDir,
          TMP: plan.tempDir,
          JSL_CONFIG_PATH: plan.jslConfigPath,
          JSL_NUM_COPIES: String(perRunCopies)
        }
      });

      lastStdout = String(stdout || '').trim();
      lastStderr = String(stderr || '').trim();
    } catch (memjetErr) {
      const stderr = String(memjetErr?.stderr || '').trim();
      const stdout = String(memjetErr?.stdout || '').trim();
      const code = memjetErr?.code ?? memjetErr?.signal ?? 'unknown';

      if (!isPrintedButTerminalAckTimedOut(stdout, stderr)) {
        throw new Error(`submitJobData memjet-rip failed (${code}). stdout=${stdout || 'n/a'} stderr=${stderr || 'n/a'}`);
      }

      degradedCount += 1;
      degradedThisRun = true;
      lastStdout = stdout;
      lastStderr = stderr;
      if (logger?.warn) {
        logger.warn({
          msg: 'memjet.submitJobData.memjet_rip.degraded_success',
          reason: 'terminal_print_ack_timeout_after_successful_submit_and_start',
          code,
          run: i + 1,
          runs,
          requestedJobId,
          effectiveJobId: normalizedJobId,
          normalizedJobId: normalizedFlag
        });
      }
    }

    if (runs > 1 && i < runs - 1) {
      const gapMs = degradedThisRun ? degradedGapMs : loopGapMs;
      if (gapMs > 0) {
        if (logger?.info) {
          logger.info({
            msg: 'memjet.submitJobData.copy_loop.wait',
            nextRun: i + 2,
            runs,
            gapMs,
            reason: degradedThisRun ? 'degraded_success_backoff' : 'normal_inter_copy_gap'
          });
        }
        await new Promise(r => setTimeout(r, gapMs));
      }
    }
  }

  return {
    ok: true,
    degraded: degradedCount > 0,
    degradedReason: degradedCount > 0 ? 'terminal_print_ack_timeout_after_submit_start_ok' : undefined,
    method: 'submitJobData',
    fallback: 'memjet-rip',
    lifecycleHandled: true,
    submissionTool: plan.tool,
    submissionArgs: plan.args,
    requestedJobId,
    effectiveJobId: normalizedJobId,
    normalizedJobId: normalizedFlag,
    copiesRequested: plan.copies,
    copiesExecutionMode: runs > 1 ? 'loop' : 'single',
    copiesCompleted: runs,
    artifactPath,
    stdout: lastStdout.slice(0, 4000),
    stderr: lastStderr.slice(0, 4000)
  };
}

function requiredEnv(name, value) {
  return String(value || '').trim() ? null : name;
}

function escapeSingleQuotes(value) {
  return String(value).replace(/'/g, `'"'"'`);
}

function buildSshSettings({ host, commandPort, eventPort, dataPort }) {
  const env = process.env;
  const backend = String(env.MEMJET_REAL_BACKEND || 'ssh').trim().toLowerCase();

  // Hardcoded production target (requested): stable endpoint/user/pass.
  const sshHost = ARROW_PES.host;
  const sshUser = 'root';
  const sshPassword = 'root';

  const defaultUserKey = env.USERPROFILE ? `${env.USERPROFILE}\\.ssh\\id_ed25519` : '';
  const sshKeyPath = String(env.MEMJET_SSH_KEY_PATH || env.RIP_SSH_KEY_PATH || defaultUserKey).trim();
  const sshPort = Number(env.MEMJET_SSH_PORT || env.RIP_SSH_PORT || 22);
  const sshBin = String(env.MEMJET_SSH_BIN || 'ssh').trim();
  const sshTimeoutMs = Number(env.MEMJET_SSH_TIMEOUT_MS || 30000);
  const cmdTemplate = String(
    env.MEMJET_SSH_REMOTE_CMD_TEMPLATE
      || '/usr/local/bin/pesctl --op {operation} --args-b64 {args_json_b64} --host {host} --command-port {commandPort} --event-port {eventPort} --data-port {dataPort}'
  ).trim();

  const missing = [];
  if (backend === 'ssh') {
    [
      requiredEnv('MEMJET_SSH_HOST', sshHost),
      requiredEnv('MEMJET_SSH_USER', sshUser),
      requiredEnv('MEMJET_SSH_REMOTE_CMD_TEMPLATE', cmdTemplate)
    ].forEach(v => { if (v) missing.push(v); });
  }

  return {
    backend,
    sshHost,
    sshUser,
    sshPassword,
    sshKeyPath,
    sshPort,
    sshBin,
    sshTimeoutMs,
    cmdTemplate,
    missing,
    defaultParams: {
      host: String(ARROW_PES.host),
      commandPort: String(ARROW_PES.commandPort),
      eventPort: String(ARROW_PES.eventPort),
      dataPort: String(ARROW_PES.dataPort)
    }
  };
}

function interpolateTemplate(template, vars) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => (key in vars ? String(vars[key]) : ''));
}

function resolveBundledPlinkPath() {
  const envPath = String(process.env.MEMJET_PLINK_PATH || '').trim();
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    path.resolve(process.cwd(), 'bin', 'plink.exe'),
    path.resolve(__dirname, '..', 'bin', 'plink.exe'),
    path.resolve(process.resourcesPath || '', 'bin', 'plink.exe')
  ].filter(Boolean);

  return candidates.find(candidate => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || null;
}

async function hasPlinkInPath() {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    await execFileAsync(cmd, ['plink'], { timeout: 5000, maxBuffer: 256 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function runSshOperation({ settings, operation, payload, logger }) {
  const argsJson = JSON.stringify(payload || {});
  const argsJsonB64 = Buffer.from(argsJson, 'utf8').toString('base64');

  const remoteCommand = interpolateTemplate(settings.cmdTemplate, {
    operation,
    args_json: argsJson,
    args_json_escaped: escapeSingleQuotes(argsJson),
    args_json_b64: argsJsonB64,
    host: settings.defaultParams.host,
    commandPort: settings.defaultParams.commandPort,
    eventPort: settings.defaultParams.eventPort,
    dataPort: settings.defaultParams.dataPort
  });

  if (!String(remoteCommand || '').trim()) {
    throw new Error('SSH backend command template produced empty command. Check MEMJET_SSH_REMOTE_CMD_TEMPLATE.');
  }

  const sshArgs = [
    '-o', 'BatchMode=no',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'PreferredAuthentications=password,keyboard-interactive,publickey',
    '-p', String(settings.sshPort),
    ...(settings.sshKeyPath ? ['-i', settings.sshKeyPath] : []),
    `${settings.sshUser}@${settings.sshHost}`,
    remoteCommand
  ];

  if (logger?.info) {
    logger.info({
      msg: 'memjet.ssh.exec',
      operation,
      sshBin: settings.sshBin,
      sshHost: settings.sshHost,
      sshUser: settings.sshUser,
      sshPort: settings.sshPort,
      remoteCommand
    });
  }

  let stdout = '';
  let stderr = '';
  try {
    let run;
    if (process.platform === 'win32' && settings.sshPassword) {
      const bundledPlink = resolveBundledPlinkPath();
      const hasPathPlink = await hasPlinkInPath();
      const plinkBin = bundledPlink || (hasPathPlink ? 'plink' : null);
      if (!plinkBin) {
        throw new Error('Windows password SSH requires plink. Add bin/plink.exe (vendored) or install PuTTY/plink in PATH.');
      }

      run = await execFileAsync(plinkBin, [
        '-batch',
        '-hostkey', ARROW_PES.sshHostKeyEd25519,
        '-P', String(settings.sshPort),
        '-l', settings.sshUser,
        '-pw', settings.sshPassword,
        settings.sshHost,
        remoteCommand
      ], {
        timeout: settings.sshTimeoutMs,
        maxBuffer: 8 * 1024 * 1024
      });
    } else {
      run = await execFileAsync(settings.sshBin, sshArgs, {
        timeout: settings.sshTimeoutMs,
        maxBuffer: 8 * 1024 * 1024
      });
    }

    stdout = String(run.stdout || '').trim();
    stderr = String(run.stderr || '').trim();
  } catch (error) {
    stdout = String(error?.stdout || '').trim();
    stderr = String(error?.stderr || '').trim();
    const code = error?.code ?? error?.signal ?? 'unknown';
    throw new Error(`SSH backend operation ${operation} failed (${code}). stdout=${stdout || 'n/a'} stderr=${stderr || 'n/a'}`);
  }

  const lines = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const jsonLine = [...lines].reverse().find(line => line.startsWith('{') || line.startsWith('['));
  const parsed = parseJsonSafe(jsonLine || stdout, null);
  if (!parsed) {
    const rawResult = {
      ok: true,
      backend: 'ssh',
      operation,
      rawStdout: stdout.slice(0, 8000),
      rawStderr: stderr.slice(0, 4000)
    };
    if (logger?.info) {
      logger.info({ msg: 'memjet.ssh.exec.result', operation, parsed: false, result: rawResult });
    }
    return rawResult;
  }

  if (logger?.info) {
    logger.info({ msg: 'memjet.ssh.exec.result', operation, parsed: true, result: parsed });
  }

  if (parsed.ok === false) {
    throw new Error(`SSH backend operation ${operation} failed (${parsed.error || 'remote_error'}): ${parsed.message || 'no message'}`);
  }

  if (operation === 'startMovingPrintheads' && hasSimulatedSignal(parsed)) {
    throw new Error(
      'SSH backend returned simulated/shim/no-op result for startMovingPrintheads. ' +
      'Remote endpoint is not a real implementation; update MEMJET_SSH_REMOTE_CMD_TEMPLATE to a real controller path.'
    );
  }

  return parsed;
}

function buildPythonProbeScript() {
  return `
import json
import sys

def probe():
    try:
        from Memjet.KareelaPesApi.Command import KPesCommand, constants as cmdConstants
        from thrift.transport import TSocket
        from thrift.transport import TTransport
        from thrift.protocol import TCompactProtocol
    except Exception as e:
        return {"ok": False, "error": "binding_import_failed", "message": str(e)}

    return {
        "ok": True,
        "commandPortConstant": getattr(cmdConstants, "COMMAND_PORT", None),
        "transport": "framed",
        "protocol": "compact"
    }

print(json.dumps(probe()))
`.trim();
}

function buildPythonCallScript() {
  return `
import json
import sys

host = sys.argv[1]
command_port = int(sys.argv[2])
method = sys.argv[3]
args = json.loads(sys.argv[4])

try:
    from Memjet.KareelaPesApi.Command import KPesCommand
    from thrift.transport import TSocket
    from thrift.transport import TTransport
    from thrift.protocol import TCompactProtocol
except Exception as e:
    print(json.dumps({"ok": False, "error": "binding_import_failed", "message": str(e)}))
    sys.exit(0)

try:
    # Confirmed command-plane transport: Thrift CompactProtocol over Framed transport to host:command_port.
    # Do not rely on KPesCommand-remote shell wrappers in this path.
    socket = TSocket.TSocket(host, command_port)
    transport = TTransport.TFramedTransport(socket)
    protocol = TCompactProtocol.TCompactProtocol(transport)
    client = KPesCommand.Client(protocol)
    transport.open()
except Exception as e:
    print(json.dumps({"ok": False, "error": "connection_failed", "message": str(e)}))
    sys.exit(0)

try:
    fn = getattr(client, method, None)
    if fn is None:
        print(json.dumps({"ok": False, "error": "method_missing", "message": "KPesCommand.Client missing method: %s" % method}))
        sys.exit(0)

    result = fn(*args)

    payload = {
        "ok": True,
        "method": method,
        "resultType": type(result).__name__ if result is not None else "NoneType",
        "resultRepr": repr(result)
    }

    if method == "getStatus" and result is not None:
        try:
            payload["status"] = {
                "sequenceNumber": getattr(result, "sequenceNumber", None),
                "engineState": getattr(getattr(result, "engineStatus", None), "state", None),
                "isReadyForPrintData": getattr(getattr(result, "engineStatus", None), "isReadyForPrintData", None),
                "jobQueueLength": len(getattr(result, "jobQueue", []) or [])
            }
        except Exception:
            pass

    print(json.dumps(payload))
except Exception as e:
    print(json.dumps({"ok": False, "error": "command_failed", "method": method, "message": str(e)}))
finally:
    try:
        transport.close()
    except Exception:
        pass
`.trim();
}

async function runPython({ pythonBin, pythonPath, script, args }) {
  const env = { ...process.env, PYTHONPATH: pythonPath };
  try {
    const { stdout, stderr } = await execFileAsync(pythonBin, ['-c', script, ...args], { env });
    return {
      ok: true,
      stdout: String(stdout || '').trim(),
      stderr: String(stderr || '').trim()
    };
  } catch (error) {
    return {
      ok: false,
      error,
      stdout: String(error?.stdout || '').trim(),
      stderr: String(error?.stderr || '').trim()
    };
  }
}

async function createLocalClient({ host, commandPort, dataPort, protocol, transport, logger }) {
  const prefix = `PES ${host}:${commandPort} (${protocol}/${transport})`;

  const pythonBin = process.env.MEMJET_PYTHON_BIN || 'python3';
  const pythonPath = buildPythonPaths().join(path.delimiter);

  const probe = await runPython({
    pythonBin,
    pythonPath,
    script: buildPythonProbeScript(),
    args: []
  });

  if (!probe.ok) {
    throw new Error(
      `real-client-factory probe failed (${prefix}): unable to launch ${pythonBin}. stderr=${probe.stderr || 'n/a'}`
    );
  }

  const probeJson = parseJsonSafe(probe.stdout, null);
  if (!probeJson?.ok) {
    throw new Error(
      `real-client-factory bindings unavailable (${prefix}): ${probeJson?.error || 'unknown_error'} ${probeJson?.message || ''}`.trim()
    );
  }

  if (logger?.info) {
    logger.info({
      msg: 'memjet.realClientFactory.ready',
      backend: 'local',
      host,
      commandPort,
      protocol,
      transport,
      pythonBin,
      commandPortConstant: probeJson.commandPortConstant,
      thriftProtocol: probeJson.protocol,
      thriftTransport: probeJson.transport
    });
  }

  const call = async (method, args = []) => {
    const run = await runPython({
      pythonBin,
      pythonPath,
      script: buildPythonCallScript(),
      args: [host, String(commandPort), method, JSON.stringify(args)]
    });

    if (!run.ok) {
      throw new Error(`PES ${method} failed to execute Python bridge: ${run.stderr || run.error?.message || 'unknown error'}`);
    }

    const payload = parseJsonSafe(run.stdout, null);
    if (!payload) {
      throw new Error(`PES ${method} returned non-JSON response: ${run.stdout || 'empty output'}`);
    }

    if (!payload.ok) {
      throw new Error(`PES ${method} failed (${payload.error || 'unknown_error'}): ${payload.message || 'no message'}`);
    }

    return payload;
  };

  return {
    async getStatus() {
      return call('getStatus', []);
    },

    async getProductInfo() {
      return call('getProductInfo', []);
    },

    clearJobQueue: async () => call('clearJobQueue', []),
    initialiseEngine: async () => call('initialiseEngine', []),
    shutdownEngine: async () => call('shutdownEngine', []),
    startServicing: async level => call('startServicing', [String(level || 'light')]),
    startPriming: async () => call('startPriming', []),
    startDepriming: async () => call('startDepriming', []),
    replaceWipers: async () => call('replaceWipers', []),
    startMovingPrintheads: async ({ printUnits = [], position = 'raised' } = {}) => call(
      'startMovingPrintheads',
      [normalizePrintUnits(printUnits), normalizePrintheadPositionEnum(position)]
    ),
    pausePrinting: async targetPage => call('pausePrinting', [targetPage == null ? null : Number(targetPage)]),
    prepareToPrint: async ips => call('prepareToPrint', [Number(ips)]),

    submitJobData: async ({ jobId, artifactPath, copies = 1 } = {}) => {
      const resolvedArtifact = artifactPath ? path.resolve(String(artifactPath)) : null;
      if (!resolvedArtifact) {
        throw new Error('submitJobData requires artifactPath');
      }
      if (!fs.existsSync(resolvedArtifact) || !fileReadable(resolvedArtifact)) {
        throw new Error(`submitJobData artifact is missing/unreadable: ${resolvedArtifact}`);
      }

      const normalized = normalizeJobId(jobId);
      const submitMode = getSubmitMode();
      if (submitMode === 'memjet-rip') {
        return runMemjetRipSubmit({
          artifactPath: resolvedArtifact,
          host,
          dataPort,
          logger,
          requestedJobId: jobId || null,
          normalizedJobId: normalized.jobId,
          normalizedFlag: normalized.normalized,
          copies
        });
      }

      const plan = buildGborcatCommand({
        host,
        dataPort,
        jobId: normalized.jobId,
        artifactPath: resolvedArtifact
      });

      if (logger?.info) {
        logger.info({
          msg: 'memjet.submitJobData.exec',
          backend: 'local',
          ripModeExpected: 'EXTERNAL',
          tool: plan.tool,
          args: plan.args,
          requestedJobId: jobId || null,
          effectiveJobId: normalized.jobId,
          normalizedJobId: normalized.normalized
        });
      }

      try {
        const { stdout, stderr } = await execFileAsync(plan.tool, plan.args, {
          timeout: Number(process.env.MEMJET_SUBMIT_TIMEOUT_MS || 30000),
          maxBuffer: 4 * 1024 * 1024
        });

        return {
          ok: true,
          method: 'submitJobData',
          submissionTool: plan.tool,
          submissionArgs: plan.args,
          requestedJobId: jobId || null,
          effectiveJobId: normalized.jobId,
          normalizedJobId: normalized.normalized,
          artifactPath: resolvedArtifact,
          stdout: String(stdout || '').trim().slice(0, 4000),
          stderr: String(stderr || '').trim().slice(0, 4000)
        };
      } catch (error) {
        const stderr = String(error?.stderr || '').trim();
        const stdout = String(error?.stdout || '').trim();
        const code = error?.code ?? error?.signal ?? 'unknown';
        throw new Error(`submitJobData gborcat failed (${code}). stdout=${stdout || 'n/a'} stderr=${stderr || 'n/a'}`);
      }
    },

    startPrinting: async () => call('startPrinting', []),
    finishPrinting: async () => call('finishPrinting', []),

    cancelJob: async () => ({ ok: true, skipped: true, reason: 'cancelJob not implemented in current command bridge' })
  };
}

async function createSshClient({ host, commandPort, eventPort, dataPort, protocol, transport, logger }) {
  const settings = buildSshSettings({ host, commandPort, eventPort, dataPort });
  if (settings.missing.length > 0) {
    throw new Error(
      `MEMJET_REAL_BACKEND=ssh requires env vars: ${settings.missing.join(', ')}. Failing closed.`
    );
  }

  if (logger?.info) {
    logger.info({
      msg: 'memjet.realClientFactory.ready',
      backend: 'ssh',
      host,
      commandPort,
      eventPort,
      dataPort,
      protocol,
      transport,
      sshHost: settings.sshHost,
      sshUser: settings.sshUser,
      sshPort: settings.sshPort
    });
  }

  const call = async (operation, payload = {}) => runSshOperation({ settings, operation, payload, logger });

  let submitChain = Promise.resolve();
  let lastSubmitFinishedAt = 0;

  const extractStatusSnapshot = (statusResult = {}) => {
    const output = String(statusResult?.output || '');
    const raw = /"raw"\s*:\s*"([\s\S]*?)"\s*,\s*"queueLen"/m.exec(output)?.[1] || output;
    const queueLenFromJson = Number(statusResult?.queueLen);
    const queueLenFromRaw = Number((/queueLen"\s*:\s*(\d+)/.exec(output) || [])[1]);
    const queueLen = Number.isFinite(queueLenFromJson)
      ? queueLenFromJson
      : (Number.isFinite(queueLenFromRaw) ? queueLenFromRaw : null);
    const stateCode = Number((/state=(\d+)/.exec(raw) || [])[1]);
    const readyMatch = /isReadyForPrintData=(true|false)/.exec(raw);
    const isReadyForPrintData = readyMatch ? readyMatch[1] === 'true' : null;
    return {
      queueLen,
      stateCode: Number.isFinite(stateCode) ? stateCode : null,
      isReadyForPrintData,
      raw: raw.slice(0, 1000)
    };
  };

  const waitForSubmitWindow = async () => {
    const minGapMs = Number(process.env.MEMJET_SUBMIT_MIN_GAP_MS || 4000);
    const maxWaitMs = Number(process.env.MEMJET_SUBMIT_READY_TIMEOUT_MS || 45000);
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const elapsedSinceLast = Date.now() - lastSubmitFinishedAt;
      if (lastSubmitFinishedAt > 0 && elapsedSinceLast < minGapMs) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      const status = await call('getStatus', {});
      const snap = extractStatusSnapshot(status);
      const queueEmpty = snap.queueLen === 0;
      const stateOk = snap.stateCode == null || [4, 6, 7].includes(snap.stateCode);
      if (queueEmpty && stateOk) {
        return;
      }

      if (logger?.info) {
        logger.info({
          msg: 'memjet.submitJobData.wait_for_window',
          queueLen: snap.queueLen,
          stateCode: snap.stateCode,
          isReadyForPrintData: snap.isReadyForPrintData
        });
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (logger?.warn) {
      logger.warn({ msg: 'memjet.submitJobData.wait_for_window.timeout', timeoutMs: maxWaitMs });
    }
  };

  return {
    async getStatus() {
      return call('getStatus', {});
    },

    async getProductInfo() {
      return call('getProductInfo', {});
    },

    clearJobQueue: async () => call('clearJobQueue', {}),
    initialiseEngine: async () => call('initialiseEngine', {}),
    shutdownEngine: async () => call('shutdownEngine', {}),
    startServicing: async level => call('startServicing', { level: String(level || 'light') }),
    startPriming: async () => call('startPriming', {}),
    startDepriming: async () => call('startDepriming', {}),
    replaceWipers: async () => call('replaceWipers', {}),
    startMovingPrintheads: async ({ printUnits = [], position = 'raised' } = {}) => call('startMovingPrintheads', {
      printUnits: normalizePrintUnits(printUnits),
      position: String(position || 'raised').trim().toLowerCase(),
      positionEnum: normalizePrintheadPositionEnum(position)
    }),
    pausePrinting: async targetPage => call('pausePrinting', { targetPage: targetPage == null ? null : Number(targetPage) }),
    prepareToPrint: async ips => call('prepareToPrint', { intendedSpeedIps: Number(ips) }),

    submitJobData: async ({ jobId, artifactPath, copies = 1 } = {}) => {
      const runOnce = async () => {
        const resolvedArtifact = artifactPath ? path.resolve(String(artifactPath)) : null;
        if (!resolvedArtifact) {
          throw new Error('submitJobData requires artifactPath');
        }
        if (!fs.existsSync(resolvedArtifact) || !fileReadable(resolvedArtifact)) {
          throw new Error(`submitJobData artifact is missing/unreadable: ${resolvedArtifact}`);
        }

        await waitForSubmitWindow();

        const normalized = normalizeJobId(jobId);
        const submitMode = getSubmitMode();
        if (submitMode === 'memjet-rip') {
          return runMemjetRipSubmit({
            artifactPath: resolvedArtifact,
            host,
            dataPort,
            logger,
            requestedJobId: jobId || null,
            normalizedJobId: normalized.jobId,
            normalizedFlag: normalized.normalized,
            copies
          });
        }

        try {
          return await call('submitJobData', {
            jobId: normalized.jobId,
            requestedJobId: jobId || null,
            normalizedJobId: normalized.normalized,
            artifactPath: resolvedArtifact,
            host: String(host),
            dataPort: Number(dataPort)
          });
        } catch (error) {
          const msg = String(error?.message || '');
          const allowFallback = String(process.env.MEMJET_SSH_SUBMIT_FALLBACK_LOCAL_GBORCAT || '1').trim() !== '0';
          if (!allowFallback || !/unsupported_op/i.test(msg) || !/submitJobData/i.test(msg)) {
            throw error;
          }

          if (String(process.env.MEMJET_SSH_SUBMIT_FALLBACK_MEMJET_RIP || '1').trim() !== '0') {
            return runMemjetRipSubmit({
              artifactPath: resolvedArtifact,
              host,
              dataPort,
              logger,
              requestedJobId: jobId || null,
              normalizedJobId: normalized.jobId,
              normalizedFlag: normalized.normalized,
              copies
            });
          }

          const plan = buildGborcatCommand({
            host,
            dataPort,
            jobId: normalized.jobId,
            artifactPath: resolvedArtifact
          });

          if (logger?.warn) {
            logger.warn({
              msg: 'memjet.submitJobData.fallback_local_gborcat',
              reason: 'remote_pesctl_unsupported_op',
              tool: plan.tool,
              args: plan.args,
              host,
              dataPort
            });
          }

          try {
            const { stdout, stderr } = await execFileAsync(plan.tool, plan.args, {
              timeout: Number(process.env.MEMJET_SUBMIT_TIMEOUT_MS || 30000),
              maxBuffer: 4 * 1024 * 1024
            });

            return {
              ok: true,
              method: 'submitJobData',
              fallback: 'local-gborcat',
              submissionTool: plan.tool,
              submissionArgs: plan.args,
              requestedJobId: jobId || null,
              effectiveJobId: normalized.jobId,
              normalizedJobId: normalized.normalized,
              artifactPath: resolvedArtifact,
              stdout: String(stdout || '').trim().slice(0, 4000),
              stderr: String(stderr || '').trim().slice(0, 4000)
            };
          } catch (gborErr) {
            const stderr = String(gborErr?.stderr || '').trim();
            const stdout = String(gborErr?.stdout || '').trim();
            const code = gborErr?.code ?? gborErr?.signal ?? 'unknown';
            throw new Error(`submitJobData fallback gborcat failed (${code}). stdout=${stdout || 'n/a'} stderr=${stderr || 'n/a'}`);
          }
        }
      };

      const chained = submitChain.then(runOnce, runOnce);
      submitChain = chained.finally(() => {
        lastSubmitFinishedAt = Date.now();
      });
      return submitChain;
    },

    startPrinting: async () => call('startPrinting', {}),
    finishPrinting: async () => call('finishPrinting', {}),

    cancelJob: async jobId => call('cancelJob', { jobId: String(jobId || '') })
  };
}

function isSshConfigured(env = process.env) {
  return Boolean(
    String(env.MEMJET_SSH_HOST || env.RIP_SSH_HOST || '').trim() &&
    String(env.MEMJET_SSH_USER || env.RIP_SSH_USER || '').trim() &&
    String(env.MEMJET_SSH_REMOTE_CMD_TEMPLATE || '').trim()
  );
}

function selectBackendCandidates(env = process.env) {
  const requestedBackend = String(env.MEMJET_REAL_BACKEND || 'ssh').trim().toLowerCase();
  const candidates = requestedBackend === 'auto'
    ? (isSshConfigured(env) ? ['ssh', 'local'] : ['local'])
    : [requestedBackend];
  return { requestedBackend, candidates };
}

async function createClient(params) {
  const { requestedBackend, candidates } = selectBackendCandidates(process.env);

  const attempts = [];
  for (const candidate of candidates) {
    try {
      const client = candidate === 'local'
        ? await createLocalClient(params)
        : (candidate === 'ssh' ? await createSshClient(params) : null);

      if (!client) {
        throw new Error(`Unsupported MEMJET_REAL_BACKEND=${candidate}. Allowed: auto, local, ssh`);
      }

      if (typeof client.startMovingPrintheads !== 'function') {
        throw new Error(`Candidate backend ${candidate} missing startMovingPrintheads implementation`);
      }

      params?.logger?.info?.({
        msg: 'memjet.realClientFactory.selection',
        requestedBackend,
        candidates,
        selectedBackend: candidate,
        strategy: 'deterministic-first-success'
      });

      return client;
    } catch (error) {
      attempts.push({ backend: candidate, error: error?.message || String(error) });
      params?.logger?.warn?.({
        msg: 'memjet.realClientFactory.selection.failedCandidate',
        requestedBackend,
        candidate,
        error: error?.message || String(error)
      });
    }
  }

  throw new Error(
    `Unable to create real client for MEMJET_REAL_BACKEND=${requestedBackend}. ` +
    `Deterministic candidates tried: ${attempts.map(a => `${a.backend}: ${a.error}`).join(' | ')}`
  );
}

module.exports = { createClient, selectBackendCandidates, isSshConfigured };
