/**
 * RIP Gateway - Windows Service Installer
 * 
 * Installs the gateway as a Windows service.
 * Must be run as Administrator.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const SERVICE_NAME = 'RIPGateway';
const SERVICE_DISPLAY_NAME = 'RIP Gateway Service';
const SERVICE_DESCRIPTION = 'Receives print jobs via HTTP and forwards to Linux printhead backend';

console.log('RIP Gateway - Windows Service Installer');
console.log('=====================================\n');

// Check if running as admin
try {
  execSync('net session', { stdio: 'pipe' });
} catch {
  console.error('❌ ERROR: Must run as Administrator');
  console.log('   Right-click PowerShell → "Run as Administrator"');
  console.log('   Then re-run: node install-windows-service.js');
  process.exit(1);
}

const gatewayDir = __dirname;
const serverJsPath = path.join(gatewayDir, 'server.js');

if (!fs.existsSync(serverJsPath)) {
  console.error('❌ ERROR: server.js not found in', gatewayDir);
  process.exit(1);
}

console.log('1. Checking Node.js...');
try {
  const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
  console.log(`   ✓ Node.js found: ${nodeVersion}`);
} catch {
  console.error('❌ ERROR: Node.js not found in PATH');
  process.exit(1);
}

console.log('\n2. Checking nssm (service wrapper)...');
const nssmPaths = [
  path.join(gatewayDir, 'nssm.exe'),
  'C:\\nssm\\nssm.exe',
  'C:\\Program Files\\nssm\\nssm.exe',
  'C:\\Program Files (x86)\\nssm\\nssm.exe'
];

let nssmPath = nssmPaths.find(p => fs.existsSync(p));

if (!nssmPath) {
  console.log('   ⚠ NSSM not found. Downloading...');
  console.log('   Please download NSSM from: https://nssm.cc/download');
  console.log('   Extract nssm.exe and place it in this folder, then re-run.');
  console.log('');
  console.log('   Quick download (PowerShell):');
  console.log('   Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile "nssm.zip"');
  process.exit(1);
}

console.log(`   ✓ NSSM found: ${nssmPath}`);

console.log('\n3. Installing dependencies...');
try {
  execSync('npm install', { cwd: gatewayDir, stdio: 'inherit' });
  console.log('   ✓ Dependencies installed');
} catch (error) {
  console.error('   ✗ Failed to install dependencies');
  process.exit(1);
}

console.log('\n4. Creating config file...');
const configPath = path.join(gatewayDir, 'config.json');
let config = {};

if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('   ✓ Existing config found');
  } catch {
    console.log('   ⚠ Existing config invalid, will create new');
  }
}

// Default config
const defaultConfig = {
  port: config.port || 8080,
  host: config.host || '0.0.0.0',
  uploadDir: config.uploadDir || path.join(process.env.LOCALAPPDATA || gatewayDir, 'rip-jobs'),
  maxFileSize: config.maxFileSize || 104857600,
  linuxBackend: {
    host: config.linuxBackend?.host || '192.168.1.100',
    port: config.linuxBackend?.port || 22,
    username: config.linuxBackend?.username || 'root',
    sshKeyPath: config.linuxBackend?.sshKeyPath || path.join(process.env.USERPROFILE || 'C:\\Users\\%USERNAME%', '.ssh', 'id_ed25519'),
    remoteUploadDir: config.linuxBackend?.remoteUploadDir || '/tmp/rip-jobs',
    gborcatPath: config.linuxBackend?.gborcatPath || '/usr/local/bin/gborcat'
  }
};

fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
console.log(`   ✓ Config created: ${configPath}`);

console.log('\n5. Installing Windows service...');

try {
  // Remove existing service
  try {
    execSync(`"${nssmPath}" stop ${SERVICE_NAME}`, { stdio: 'ignore' });
    execSync(`"${nssmPath}" remove ${SERVICE_NAME} confirm`, { stdio: 'ignore' });
  } catch {
    // Service didn't exist, that's fine
  }

  // Install new service
  const installCmds = [
    ['install', SERVICE_NAME, 'node'],
    ['set', SERVICE_NAME, 'Application', process.execPath],
    ['set', SERVICE_NAME, 'AppDirectory', gatewayDir],
    ['set', SERVICE_NAME, 'AppParameters', serverJsPath],
    ['set', SERVICE_NAME, 'DisplayName', SERVICE_DISPLAY_NAME],
    ['set', SERVICE_NAME, 'Description', SERVICE_DESCRIPTION],
    ['set', SERVICE_NAME, 'Start', 'SERVICE_AUTO_START'],
    ['set', SERVICE_NAME, 'AppStdout', path.join(gatewayDir, 'service.log')],
    ['set', SERVICE_NAME, 'AppStderr', path.join(gatewayDir, 'service.log')],
    ['set', SERVICE_NAME, 'AppRotateFiles', '1'],
    ['set', SERVICE_NAME, 'AppRotateBytes', '10485760']
  ];

  for (const args of installCmds) {
    execSync(`"${nssmPath}" ${args.map(a => `"${a}"`).join(' ')}`, { stdio: 'pipe' });
  }

  console.log('   ✓ Service installed');
} catch (error) {
  console.error('   ✗ Failed to install service:', error.message);
  process.exit(1);
}

console.log('\n6. Starting service...');
try {
  execSync(`"${nssmPath}" start ${SERVICE_NAME}`, { stdio: 'inherit' });
  console.log('   ✓ Service started');
} catch (error) {
  console.error('   ✗ Failed to start service');
  console.log('   Try: net start RIPGateway');
}

console.log('\n' + '═'.repeat(60));
console.log('✅ Installation Complete!');
console.log('═'.repeat(60));
console.log('');
console.log('Service: RIPGateway');
console.log(`Config:  ${configPath}`);
console.log(`Logs:    ${path.join(gatewayDir, 'service.log')}`);
console.log('');
console.log('📋 Useful commands:');
console.log(`   net start ${SERVICE_NAME}        # Start service`);
console.log(`   net stop ${SERVICE_NAME}         # Stop service`);
console.log(`   sc query ${SERVICE_NAME}         # Check status`);
console.log(`   "${nssmPath}" edit ${SERVICE_NAME}      # Edit service settings`);
console.log('');
console.log('🌐 Test the gateway:');
console.log(`   curl http://localhost:${defaultConfig.port}/api/health`);
console.log(`   curl http://localhost:${defaultConfig.port}/api/ssh-test`);
console.log('');
console.log('⚠ IMPORTANT: Edit the config before using:');
console.log(`   ${configPath}`);
console.log('   Update linuxBackend.host to your Linux printhead IP');
console.log('   Update linuxBackend.sshKeyPath to your SSH private key');
console.log('');
