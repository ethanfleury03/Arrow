/**
 * RIP Gateway Service Installer
 * 
 * Installs the gateway as a systemd service on Linux (printer PC)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const SERVICE_NAME = 'rip-gateway';
const SERVICE_FILE = `/etc/systemd/system/${SERVICE_NAME}.service`;

const serviceContent = `[Unit]
Description=RIP Gateway Service for Print Jobs
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/rip-gateway
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment="NODE_ENV=production"
Environment="RIP_GATEWAY_PORT=8080"
Environment="RIP_GATEWAY_HOST=0.0.0.0"
Environment="RIP_GATEWAY_UPLOAD_DIR=/tmp/rip-jobs"
Environment="PES_HOST=localhost"
Environment="PES_DATA_PORT=9092"

[Install]
WantedBy=multi-user.target
`;

console.log('RIP Gateway Service Installer');
console.log('=============================\n');

try {
  // Check if running as root
  if (process.getuid && process.getuid() !== 0) {
    console.error('Error: This installer must be run as root (sudo)');
    process.exit(1);
  }

  // Check if files exist
  const gatewayDir = path.dirname(__filename);
  const serverJsPath = path.join(gatewayDir, 'server.js');
  const packageJsonPath = path.join(gatewayDir, 'package.json');

  if (!fs.existsSync(serverJsPath)) {
    console.error('Error: server.js not found in', gatewayDir);
    process.exit(1);
  }

  console.log('1. Installing to /opt/rip-gateway...');
  
  // Create directory
  execSync('mkdir -p /opt/rip-gateway', { stdio: 'inherit' });
  
  // Copy files
  execSync(`cp -r "${gatewayDir}"/* /opt/rip-gateway/`, { stdio: 'inherit' });
  
  console.log('2. Installing dependencies...');
  execSync('cd /opt/rip-gateway && npm install --production', { stdio: 'inherit' });
  
  console.log('3. Creating systemd service...');
  fs.writeFileSync(SERVICE_FILE, serviceContent);
  
  console.log('4. Enabling and starting service...');
  execSync('systemctl daemon-reload', { stdio: 'inherit' });
  execSync(`systemctl enable ${SERVICE_NAME}`, { stdio: 'inherit' });
  execSync(`systemctl start ${SERVICE_NAME}`, { stdio: 'inherit' });
  
  console.log('\n✅ Installation complete!');
  console.log('\nService status:');
  execSync(`systemctl status ${SERVICE_NAME} --no-pager`, { stdio: 'inherit' });
  
  console.log('\n📋 Useful commands:');
  console.log(`   sudo systemctl status ${SERVICE_NAME}   # Check status`);
  console.log(`   sudo systemctl restart ${SERVICE_NAME}  # Restart service`);
  console.log(`   sudo systemctl stop ${SERVICE_NAME}     # Stop service`);
  console.log(`   sudo journalctl -u ${SERVICE_NAME} -f   # View logs`);
  console.log(`\n🌐 Gateway URL: http://<printer-ip>:8080/api/health`);
  
} catch (error) {
  console.error('\n❌ Installation failed:', error.message);
  process.exit(1);
}
