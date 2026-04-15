/**
 * RIP Gateway Service
 * 
 * Runs on the Printer PC (Linux with PES/printhead).
 * Receives print jobs via HTTP from laptops over WiFi/LAN.
 * Executes gborcat/memjet-rip to send jobs to the printhead.
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');

const execFileAsync = promisify(execFile);

// Configuration
const PORT = process.env.RIP_GATEWAY_PORT || 8080;
const HOST = process.env.RIP_GATEWAY_HOST || '0.0.0.0';
const UPLOAD_DIR = process.env.RIP_GATEWAY_UPLOAD_DIR || '/tmp/rip-jobs';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

// PES connection settings (passed through from laptop or use defaults)
const PES_HOST = process.env.PES_HOST || 'localhost';
const PES_DATA_PORT = process.env.PES_DATA_PORT || 9092;

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();

// Enable CORS for LAN access
app.use(cors({
  origin: '*', // In production, restrict to your LAN subnet
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
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    // Accept PDF files
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'rip-gateway',
    version: '1.0.0',
    pesHost: PES_HOST,
    pesDataPort: PES_DATA_PORT,
    uploadDir: UPLOAD_DIR,
    timestamp: new Date().toISOString()
  });
});

// Get printer status (proxies to local PES)
app.get('/api/status', async (req, res) => {
  try {
    // You can extend this to actually query PES status
    // For now, return gateway status
    res.json({
      ok: true,
      gateway: 'running',
      pesHost: PES_HOST,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Submit a print job
// POST /api/jobs with PDF file and metadata
app.post('/api/jobs', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: 'No file uploaded'
      });
    }

    const jobId = req.headers['x-job-id'] || crypto.randomUUID();
    const filePath = req.file.path;
    const { copies = 1, width, height, mediaType } = req.body;

    console.log(`[JOB ${jobId}] Received file: ${req.file.originalname}`);
    console.log(`[JOB ${jobId}] Size: ${req.file.size} bytes`);
    console.log(`[JOB ${jobId}] Copies: ${copies}`);

    // Validate file exists and is readable
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new Error('Uploaded file is not readable');
    }

    // Submit to printhead using gborcat
    const result = await submitToPrinthead({
      jobId,
      filePath,
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
    
    // Clean up uploaded file on error
    if (req.file?.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}
    }
    
    res.status(500).json({
      ok: false,
      error: error.message,
      durationMs: duration
    });
  }
});

// Submit job without file (for pre-staged files)
app.post('/api/jobs/submit', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { jobId, filePath, copies = 1 } = req.body;
    
    if (!jobId || !filePath) {
      return res.status(400).json({
        ok: false,
        error: 'Missing jobId or filePath'
      });
    }

    // Validate file exists
    const fullPath = path.resolve(filePath);
    try {
      await fs.promises.access(fullPath, fs.constants.R_OK);
    } catch {
      throw new Error(`File not readable: ${filePath}`);
    }

    const result = await submitToPrinthead({
      jobId,
      filePath: fullPath,
      copies: parseInt(copies, 10) || 1
    });

    const duration = Date.now() - startTime;
    
    res.json({
      ok: true,
      jobId,
      status: 'submitted',
      durationMs: duration,
      result
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      durationMs: Date.now() - startTime
    });
  }
});

// List active jobs (in upload directory)
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

// Get job status
app.get('/api/jobs/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const filePath = path.join(UPLOAD_DIR, `${jobId}.pdf`);
  
  try {
    const stats = await fs.promises.stat(filePath);
    res.json({
      jobId,
      exists: true,
      size: stats.size,
      uploadedAt: stats.mtime
    });
  } catch {
    res.status(404).json({
      jobId,
      exists: false
    });
  }
});

// Delete a job file
app.delete('/api/jobs/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const filePath = path.join(UPLOAD_DIR, `${jobId}.pdf`);
  
  try {
    await fs.promises.unlink(filePath);
    res.json({ ok: true, message: `Job ${jobId} deleted` });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * Submit a job to the printhead using gborcat
 */
async function submitToPrinthead({ jobId, filePath, copies = 1 }) {
  // Find gborcat binary
  const gborcatPaths = [
    '/usr/local/bin/gborcat',
    '/usr/bin/gborcat',
    '/opt/memjet/bin/gborcat',
    './gborcat',
    path.join(process.cwd(), 'gborcat')
  ];
  
  const gborcatBin = gborcatPaths.find(p => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  
  if (!gborcatBin) {
    throw new Error('gborcat binary not found. Install memjet tools or set GBORCAT_BIN env var.');
  }

  // Build gborcat arguments
  const args = [
    '-h', PES_HOST,
    '-c', String(copies),
    '-r', '1', // rip mode
    '-j', jobId,
    '-v', filePath
  ];

  // Add port if not default
  if (PES_DATA_PORT !== 9092) {
    args.splice(2, 0, '-p', String(PES_DATA_PORT));
  }

  console.log(`[GBORCAT] Executing: ${gborcatBin} ${args.join(' ')}`);

  try {
    const { stdout, stderr } = await execFileAsync(gborcatBin, args, {
      timeout: 300000, // 5 minute timeout for large jobs
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for output
    });

    return {
      ok: true,
      tool: gborcatBin,
      args,
      stdout: stdout?.slice(0, 4000), // Truncate for log size
      stderr: stderr?.slice(0, 2000)
    };

  } catch (error) {
    const stderr = error?.stderr || '';
    const stdout = error?.stdout || '';
    
    // Check for specific error patterns
    if (stderr.includes('Connection refused')) {
      throw new Error(`PES connection refused. Is the printhead controller running on ${PES_HOST}:${PES_DATA_PORT}?`);
    }
    
    if (stderr.includes('Permission denied')) {
      throw new Error('Permission denied accessing printhead. Check user permissions.');
    }

    throw new Error(`gborcat failed: ${error.message}. stderr: ${stderr.slice(0, 500)}`);
  }
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
    return res.status(400).json({
      ok: false,
      error: err.message
    });
  }
  
  res.status(500).json({
    ok: false,
    error: err.message || 'Internal server error'
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              RIP Gateway Service v1.0.0                    ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║  Listening: http://${HOST}:${PORT}                          ║`);
  console.log(`║  Upload dir: ${UPLOAD_DIR}                                  ║`);
  console.log(`║  PES Host: ${PES_HOST}:${PES_DATA_PORT}                     ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Ready to receive print jobs from laptops on the network.');
});
