/**
 * RIP Gateway Service
 * 
 * Runs on Windows Printer PC.
 * Receives print jobs via HTTP from remote laptops.
 * Submits jobs to Linux printhead backend via SSH.
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, exec } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const os = require('node:os');

const execAsync = promisify(exec);

// Load config
const CONFIG_PATH = process.env.RIP_CONFIG_PATH || path.join(__dirname, 'config.json');
let config = loadConfig();

function loadConfig() {
  const defaultConfig = {
    port: 8080,
    host: '0.0.0.0',
    uploadDir: path.join(os.tmpdir(), 'rip-jobs'),
    maxFileSize: 100 * 1024 * 1024, // 100MB
    // Linux printhead backend
    linuxBackend: {
      host: '192.168.1.100',  // Linux printhead PC
      port: 22,
      username: 'root',
      // Path to SSH key (Windows-style path)
      sshKeyPath: path.join(os.homedir(), '.ssh', 'id_ed25519'),
      // Remote paths on Linux
      remoteUploadDir: '/tmp/rip-jobs',
      gborcatPath: '/usr/local/bin/gborcat'
    }
  };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return { ...defaultConfig, ...userConfig };
    }
  } catch (err) {
    console.warn('[CONFIG] Failed to load config.json, using defaults:', err.message);
  }
  
  return defaultConfig;
}

const PORT = config.port;
const HOST = config.host;
const UPLOAD_DIR = config.uploadDir;
const MAX_FILE_SIZE = config.maxFileSize;
const LINUX = config.linuxBackend;

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();

// Enable CORS for LAN access
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Job-Id']
}));

app.use(express.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const jobId = req.headers['x-job-id'] || crypto.randomUUID();
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `${jobId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'rip-gateway',
    version: '1.1.0',
    platform: os.platform(),
    linuxBackend: {
      host: LINUX.host,
      port: LINUX.port,
      username: LINUX.username
    },
    timestamp: new Date().toISOString()
  });
});

// Test SSH connection
app.get('/api/ssh-test', async (req, res) => {
  try {
    const result = await testSSH();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Submit a print job
app.post('/api/jobs', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No file uploaded' });
    }

    const jobId = req.headers['x-job-id'] || crypto.randomUUID();
    const localFilePath = req.file.path;
    const { copies = 1, width, height, mediaType } = req.body;

    console.log(`[JOB ${jobId}] Received: ${req.file.originalname} (${req.file.size} bytes)`);
    console.log(`[JOB ${jobId}] Copies: ${copies}`);

    // Step 1: Upload file to Linux backend via SCP
    const remoteFilePath = path.posix.join(LINUX.remoteUploadDir, `${jobId}.pdf`);
    await uploadViaSCP(localFilePath, remoteFilePath);
    console.log(`[JOB ${jobId}] Uploaded to Linux backend`);

    // Step 2: Submit to printhead via SSH
    const result = await submitToPrintheadViaSSH({
      jobId,
      remoteFilePath,
      copies: parseInt(copies, 10) || 1,
      width,
      height
    });

    const duration = Date.now() - startTime;
    console.log(`[JOB ${jobId}] Completed in ${duration}ms`);
    
    res.json({
      ok: true,
      jobId,
      status: 'submitted',
      durationMs: duration,
      result
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[JOB] Failed after ${duration}ms:`, error.message);
    
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    
    res.status(500).json({
      ok: false,
      error: error.message,
      durationMs: duration
    });
  }
});

// List jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const files = await fs.promises.readdir(UPLOAD_DIR);
    const jobs = files
      .filter(f => f.endsWith('.pdf'))
      .map(f => ({
        jobId: path.basename(f, '.pdf'),
        fileName: f,
        uploadedAt: fs.statSync(path.join(UPLOAD_DIR, f)).mtime
      }));
    
    res.json({ jobs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete job
app.delete('/api/jobs/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const localPath = path.join(UPLOAD_DIR, `${jobId}.pdf`);
  
  try {
    // Delete local copy
    await fs.promises.unlink(localPath);
    
    // Delete remote copy
    await deleteRemoteFile(path.posix.join(LINUX.remoteUploadDir, `${jobId}.pdf`));
    
    res.json({ ok: true, message: `Job ${jobId} deleted` });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Test SSH connection to Linux backend
 */
async function testSSH() {
  const keyPath = LINUX.sshKeyPath.replace(/\\/g, '/'); // Fix Windows paths
  
  return new Promise((resolve, reject) => {
    const sshArgs = [
      '-i', keyPath,
      '-p', String(LINUX.port),
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=5',
      `${LINUX.username}@${LINUX.host}`,
      'echo "SSH_OK"'
    ];

    const proc = spawn('ssh', sshArgs, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code === 0 && stdout.includes('SSH_OK')) {
        resolve({ connected: true, host: LINUX.host });
      } else {
        reject(new Error(`SSH failed (code ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`SSH spawn error: ${err.message}`)));
  });
}

/**
 * Upload file to Linux backend via SCP
 */
async function uploadViaSCP(localPath, remotePath) {
  const keyPath = LINUX.sshKeyPath.replace(/\\/g, '/');
  
  // Create remote directory first
  await sshExec(`mkdir -p ${LINUX.remoteUploadDir}`);
  
  return new Promise((resolve, reject) => {
    const scpArgs = [
      '-i', keyPath,
      '-P', String(LINUX.port),
      '-o', 'StrictHostKeyChecking=no',
      localPath,
      `${LINUX.username}@${LINUX.host}:${remotePath}`
    ];

    const proc = spawn('scp', scpArgs, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`SCP failed (code ${code}): ${stderr}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`SCP spawn error: ${err.message}`)));
  });
}

/**
 * Delete remote file via SSH
 */
async function deleteRemoteFile(remotePath) {
  return sshExec(`rm -f ${remotePath}`).catch(() => {}); // Ignore errors
}

/**
 * Execute command on Linux backend via SSH
 */
async function sshExec(command) {
  const keyPath = LINUX.sshKeyPath.replace(/\\/g, '/');
  
  return new Promise((resolve, reject) => {
    const sshArgs = [
      '-i', keyPath,
      '-p', String(LINUX.port),
      '-o', 'StrictHostKeyChecking=no',
      `${LINUX.username}@${LINUX.host}`,
      command
    ];

    const proc = spawn('ssh', sshArgs, { 
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data; });
    proc.stderr.on('data', (data) => { stderr += data; });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`SSH exec failed (code ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`SSH exec error: ${err.message}`)));
  });
}

/**
 * Submit job to printhead via SSH to Linux backend
 */
async function submitToPrintheadViaSSH({ jobId, remoteFilePath, copies = 1 }) {
  // Build gborcat command to run on Linux
  const gborcatArgs = [
    '-c', String(copies),
    '-r', '1', // rip mode
    '-j', jobId,
    '-v', remoteFilePath
  ];

  const command = `${LINUX.gborcatPath} ${gborcatArgs.join(' ')}`;
  
  console.log(`[GBORCAT] Executing on ${LINUX.host}: ${command}`);

  const result = await sshExec(command);
  
  return {
    ok: true,
    host: LINUX.host,
    command,
    stdout: result.stdout?.slice(0, 4000),
    stderr: result.stderr?.slice(0, 2000)
  };
}

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        ok: false,
        error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB`
      });
    }
    return res.status(400).json({ ok: false, error: err.message });
  }
  
  res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                RIP Gateway Service v1.1.0                      ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Platform: ${os.platform().padEnd(52)} ║`);
  console.log(`║  Listening: http://${HOST}:${PORT}${' '.repeat(33 - String(PORT).length)} ║`);
  console.log(`║  Upload dir: ${UPLOAD_DIR.slice(0, 50).padEnd(50)} ║`);
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Linux Backend: ${LINUX.username}@${LINUX.host}:${LINUX.port}${' '.repeat(34 - LINUX.host.length - String(LINUX.port).length - LINUX.username.length)} ║`);
  console.log(`║  SSH Key: ${LINUX.sshKeyPath.slice(0, 54).padEnd(54)} ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Ready to receive print jobs from laptops on the network.');
  console.log(`Test SSH: GET http://localhost:${PORT}/api/ssh-test`);
});
