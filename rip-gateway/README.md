# RIP Gateway

HTTP Gateway service that runs on the Windows Printer PC. Receives print jobs from remote laptops via HTTP and forwards them to the Linux printhead backend via SSH/SCP.

## Architecture

```
┌─────────────────┐                    ┌──────────────────────┐                    ┌─────────────────┐
│  Remote Laptop  │  ────WiFi/LAN────► │   Printer PC         │  ─────SSH───────►  │  Linux Backend  │
│   (Windows)     │                    │   (Windows)          │                    │  (Printhead)    │
│                 │   HTTP POST jobs   │   ┌──────────────┐   │   SCP (file)       │   ┌─────────┐   │
│  ┌───────────┐  │ ────────────────►  │   │ rip-gateway  │   │ ────────────────►  │   │ gborcat │   │
│  │  rip-ui   │  │                    │   │  (Node.js)   │   │                    │   └────┬────┘   │
│  │  (bridge) │  │                    │   └──────────────┘   │                    │        │      │
│  └───────────┘  │                    │                      │                    │   [PRINTHEAD]   │
└─────────────────┘                    └──────────────────────┘                    └─────────────────┘
```

## Requirements

- Windows 10/11
- Node.js 18+ (LTS)
- SSH client (Windows 10+ has OpenSSH built-in)
- [NSSM](https://nssm.cc/) (for service installation)
- SSH key pair for Linux backend access

## Installation

### Step 1: Install Dependencies

```powershell
cd C:\arrow\rip-gateway
npm install
```

### Step 2: Download NSSM

Download NSSM (service wrapper): https://nssm.cc/download

Extract `nssm.exe` and place it in the `rip-gateway` folder.

### Step 3: Configure

Edit `config.json` in the rip-gateway folder:

```json
{
  "port": 8080,
  "host": "0.0.0.0",
  "linuxBackend": {
    "host": "192.168.1.100",
    "port": 22,
    "username": "root",
    "sshKeyPath": "C:\\Users\\YOUR_USERNAME\\.ssh\\id_ed25519",
    "remoteUploadDir": "/tmp/rip-jobs",
    "gborcatPath": "/usr/local/bin/gborcat"
  }
}
```

**Important:** Update `linuxBackend.host` to match your Linux printhead PC IP.

### Step 4: Install as Windows Service

**Run PowerShell as Administrator**, then:

```powershell
cd C:\arrow\rip-gateway
node install-windows-service.js
```

This will:
- Install the service as `RIPGateway`
- Configure auto-start
- Start the service

### Step 5: Test

```powershell
# Test gateway is running
curl http://localhost:8080/api/health

# Test SSH connection to Linux backend
curl http://localhost:8080/api/ssh-test
```

## Manual Mode (No Service)

If you prefer not to install as a service, just run:

```powershell
cd C:\arrow\rip-gateway
npm start
```

## Remote Laptop Setup

On the laptop that will send print jobs:

1. Edit `rip-ui/bridge-data/network.json`:
```json
{
  "settings": {
    "printerHost": "192.168.1.X",
    "gatewayPort": 8080
  }
}
```
(Use the Windows Printer PC IP, not the Linux backend!)

2. Run bridge with HTTP gateway mode:
```powershell
set MEMJET_SUBMIT_MODE=http-gateway
npm run bridge:start
```

## Troubleshooting

### Service won't start
```powershell
# Check service status
sc query RIPGateway

# View logs
type C:\arrow\rip-gateway\service.log

# Manual test
npm start
```

### SSH connection fails
- Verify SSH key path is correct in config.json (use double backslashes: `\\`)
- Test SSH manually: `ssh -i C:\Users\...\.ssh\id_ed25519 root@LINUX_IP`
- Ensure OpenSSH client is installed on Windows

### Windows Firewall
Allow port 8080 through Windows Defender Firewall:
```powershell
netsh advfirewall firewall add rule name="RIP Gateway" dir=in action=allow protocol=tcp localport=8080
```

## Service Commands

```powershell
# Start/Stop/Restart
net start RIPGateway
net stop RIPGateway

# Remove service completely (run as Admin)
.\nssm.exe remove RIPGateway confirm
```
