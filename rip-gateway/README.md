# RIP Gateway

HTTP Gateway service that runs on the Printer PC to receive print jobs from laptops over WiFi/LAN.

## Quick Start

### 1. Install on Printer PC (Linux with PES/printhead)

```bash
cd /opt/rip-gateway
sudo npm install
sudo node install-service.js
```

### 2. Verify it's running

```bash
curl http://localhost:8080/api/health
```

Should return:
```json
{
  "ok": true,
  "service": "rip-gateway",
  "version": "1.0.0",
  "pesHost": "localhost",
  "pesDataPort": 9092
}
```

### 3. Get Printer PC IP Address

```bash
ip addr show | grep inet
```

Note the IP (e.g., `192.168.1.115`)

## Configure Laptop (RIP-UI)

Edit `rip-ui/bridge-data/network.json`:

```json
{
  "printerIp": "192.168.1.115",
  "printerPort": 22,
  "gatewayPort": 8080
}
```

## API Endpoints

### Health Check
```bash
GET http://printer-ip:8080/api/health
```

### Submit Print Job
```bash
POST http://printer-ip:8080/api/jobs
Content-Type: multipart/form-data

Form fields:
  - file: <PDF file>
  - copies: <number of copies>

Headers:
  - X-Job-Id: <optional job ID>
```

Example with curl:
```bash
curl -X POST \
  http://192.168.1.115:8080/api/jobs \
  -H "X-Job-Id: job-123" \
  -F "file=@/path/to/print.pdf" \
  -F "copies=2"
```

### List Jobs
```bash
GET http://printer-ip:8080/api/jobs
```

### Get Job Status
```bash
GET http://printer-ip:8080/api/jobs/{jobId}
```

### Delete Job
```bash
DELETE http://printer-ip:8080/api/jobs/{jobId}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RIP_GATEWAY_PORT` | 8080 | HTTP server port |
| `RIP_GATEWAY_HOST` | 0.0.0.0 | Bind address |
| `RIP_GATEWAY_UPLOAD_DIR` | /tmp/rip-jobs | Where PDFs are stored |
| `PES_HOST` | localhost | PES controller hostname |
| `PES_DATA_PORT` | 9092 | PES data port |
| `GBORCAT_BIN` | auto | Path to gborcat binary |

## Service Management

```bash
# Check status
sudo systemctl status rip-gateway

# Restart
sudo systemctl restart rip-gateway

# View logs
sudo journalctl -u rip-gateway -f

# Stop
sudo systemctl stop rip-gateway

# Disable auto-start
sudo systemctl disable rip-gateway
```

## Architecture

```
Laptop (RIP-UI)          Printer PC (Gateway)
     │                           │
     │  POST /api/jobs           │
     │  (PDF file) ──────────────┼────► ┌─────────────────┐
     │                           │      │  Save to disk   │
     │                           │      │  Run gborcat    │
     │                           │      │  ───────► PES   │
     │  Response                 │      │                 │
     │  (job result) ◄───────────┼──────│                 │
     │                           │      └─────────────────┘
```

## Troubleshooting

### Gateway won't start
```bash
# Check Node.js version (need v18+)
node --version

# Check if port 8080 is in use
sudo lsof -i :8080
```

### Can't connect from laptop
```bash
# On printer PC, check firewall
sudo iptables -L -n | grep 8080

# Open port if needed
sudo iptables -A INPUT -p tcp --dport 8080 -j ACCEPT
```

### gborcat not found
```bash
# Find gborcat location
which gborcat
find / -name gborcat 2>/dev/null

# Set env var
export GBORCAT_BIN=/path/to/gborcat
```

### Jobs fail to print
Check gateway logs:
```bash
sudo journalctl -u rip-gateway -n 100
```

## Security Notes

- Gateway binds to `0.0.0.0` (all interfaces) by default
- No authentication implemented (LAN-only assumed)
- Consider firewall rules to restrict access
- For production, add API key authentication
