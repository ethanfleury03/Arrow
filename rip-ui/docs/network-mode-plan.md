# Local Network Mode Implementation Plan

## Overview
Enable RIP-UI to run on laptops over WiFi while connecting to a remote printer PC on the LAN.

## Architecture

```
Laptop (RIP-UI) ←──WiFi/LAN──→ Printer PC (Gateway) → PES/Printhead
```

## Phase 1: Settings UI (RIP-UI Frontend)

### New Settings Panel: "Network & Connection"

**Location:** Left sidebar or hamburger menu → Settings → Network

**Fields:**

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Connection Mode | Select | "Local Network" | Options: "Local Network", "USB/Direct", "VPN/Tailscale" |
| Printer IP | Text | "192.168.1.115" | Target printer/gateway IP address |
| Printer Port | Number | 22 | SSH port for gateway connection |
| SSH Username | Text | "root" | SSH user on printer PC |
| SSH Key Path | Text | "~/.ssh/id_ed25519" | Path to SSH private key |
| Gateway Port | Number | 8080 | HTTP port for gateway service on printer PC |
| PES Port | Number | 9090 | PES/Thrift port on printer PC |
| Auto-connect on startup | Toggle | false | Automatically connect when app starts |
| Connection timeout (sec) | Number | 10 | Timeout for connection attempts |

**UI Components:**
- Settings form with validation
- "Test Connection" button (pings gateway, checks SSH)
- "Save & Apply" button
- Connection status indicator (disconnected/connecting/connected/error)
- Last error message display

**Storage:**
- Save to `bridge-data/settings.json` (or use existing config system)
- Load on app startup
- Changes require bridge restart (or hot-reload if we implement)

## Phase 2: Bridge Enhancement (Node.js)

### Configuration System

Extend `bridge/config.js` to support runtime configuration:

```javascript
// config.js additions
const CONFIG_PATH = path.join(__dirname, '..', 'bridge-data', 'settings.json');

function loadUserConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return getDefaultConfig();
  }
}

function getDefaultConfig() {
  return {
    connectionMode: 'local-network',
    printerIp: '192.168.1.115',
    printerSshPort: 22,
    sshUsername: 'root',
    sshKeyPath: path.join(os.homedir(), '.ssh', 'id_ed25519'),
    gatewayPort: 8080,
    pesPort: 9090,
    autoConnect: false,
    connectionTimeout: 10000
  };
}
```

### Connection Manager

Create `bridge/connection-manager.js`:

```javascript
class ConnectionManager {
  constructor(config) {
    this.config = config;
    this.status = 'disconnected'; // disconnected, connecting, connected, error
    this.lastError = null;
  }

  async connect() {
    // 1. Test SSH connectivity
    // 2. Establish gateway connection
    // 3. Start status polling
  }

  async disconnect() {
    // Cleanup connections
  }

  getStatus() {
    return {
      status: this.status,
      lastError: this.lastError,
      config: this.config
    };
  }
}
```

## Phase 3: Gateway Service (Printer PC)

### Python FastAPI Gateway

New component on printer PC: `gateway/` directory

```python
# gateway/main.py
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import subprocess
import os

app = FastAPI(title="RIP Gateway")

# CORS for LAN access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for your LAN subnet in production
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/v1/pes/command")
async def proxy_pes_command(command: dict):
    """Proxy PES commands from laptop to local PES service"""
    # Forward to local PES/Thrift
    pass

@app.get("/api/v1/status")
async def get_status():
    """Return printer status"""
    pass

@app.post("/api/v1/jobs")
async def receive_job(job_data: dict):
    """Receive print jobs from laptop"""
    pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
```

### Gateway Installation Script

`scripts/install-gateway.sh` for printer PC:

```bash
#!/bin/bash
# Install gateway service on printer PC

cd /opt/rip-gateway

# Install Python deps
pip3 install fastapi uvicorn python-multipart

# Create systemd service
sudo tee /etc/systemd/system/rip-gateway.service << EOF
[Unit]
Description=RIP Gateway Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/rip-gateway
ExecStart=/usr/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8080
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable rip-gateway
sudo systemctl start rip-gateway
```

## Phase 4: IPC Bridge (Electron ↔ Node Bridge)

### Electron Main Process

Extend `electron/main.js`:

```javascript
// Handle settings from renderer
ipcMain.handle('settings:load', () => {
  return loadUserConfig();
});

ipcMain.handle('settings:save', (event, settings) => {
  saveUserConfig(settings);
  // Notify bridge to reload config
  restartBridge();
});

ipcMain.handle('connection:test', async (event, settings) => {
  // Test SSH and gateway connectivity
  return testConnection(settings);
});

ipcMain.handle('connection:status', () => {
  return getConnectionStatus();
});
```

### Frontend Settings Component (React/Vanilla)

New file: `src/components/NetworkSettings.js`

```javascript
// Pseudo-code for settings UI
function NetworkSettings() {
  const [settings, setSettings] = useState({});
  const [status, setStatus] = useState('disconnected');
  
  useEffect(() => {
    window.electron.invoke('settings:load').then(setSettings);
  }, []);
  
  const testConnection = async () => {
    const result = await window.electron.invoke('connection:test', settings);
    setStatus(result.ok ? 'connected' : 'error');
  };
  
  const saveSettings = () => {
    window.electron.invoke('settings:save', settings);
  };
  
  return (
    <div className="network-settings">
      <h2>Network & Connection Settings</h2>
      
      <label>Connection Mode</label>
      <select value={settings.connectionMode} onChange={...}>
        <option value="local-network">Local Network (WiFi)</option>
        <option value="direct">Direct USB/Ethernet</option>
        <option value="vpn">VPN/Tailscale</option>
      </select>
      
      <label>Printer IP Address</label>
      <input 
        type="text" 
        value={settings.printerIp}
        placeholder="192.168.1.115"
        onChange={...}
      />
      
      <label>SSH Port</label>
      <input type="number" value={settings.printerSshPort} onChange={...} />
      
      <label>SSH Username</label>
      <input type="text" value={settings.sshUsername} onChange={...} />
      
      <label>SSH Key Path</label>
      <input type="text" value={settings.sshKeyPath} onChange={...} />
      
      <div className="button-row">
        <button onClick={testConnection}>Test Connection</button>
        <button onClick={saveSettings}>Save & Apply</button>
      </div>
      
      <div className={`status-indicator ${status}`}>
        Status: {status}
      </div>
    </div>
  );
}
```

## File Structure

```
rip-ui/
├── bridge/
│   ├── config.js                 # Extended for user config
│   ├── connection-manager.js     # NEW: Manages LAN connections
│   └── server.js                 # Modified to use config
├── gateway/                      # NEW: Python gateway for printer PC
│   ├── main.py
│   ├── requirements.txt
│   └── install.sh
├── src/
│   └── components/
│       └── NetworkSettings.js    # NEW: Settings UI
├── electron/
│   └── main.js                   # Extended for IPC
├── bridge-data/
│   └── settings.json             # NEW: User settings storage
└── docs/
    └── network-mode-plan.md      # This document
```

## Development Phases

### Week 1: Settings UI + Config System
- [ ] Create NetworkSettings component
- [ ] Implement settings save/load
- [ ] Add IPC handlers in Electron main
- [ ] Test setting persistence

### Week 2: Bridge Enhancements
- [ ] Refactor config.js for runtime changes
- [ ] Create ConnectionManager class
- [ ] Modify server.js to use dynamic config
- [ ] Implement connection status API

### Week 3: Gateway Service
- [ ] Build FastAPI gateway prototype
- [ ] Implement job proxy endpoint
- [ ] Implement status endpoint
- [ ] Create install script for printer PC

### Week 4: Integration & Testing
- [ ] End-to-end testing on LAN
- [ ] Error handling edge cases
- [ ] Documentation
- [ ] Create setup guide for users

## Minimal Viable Product (MVP)

For fastest implementation, start with:

1. **Hardcoded IP** (skip full settings UI initially)
2. **SSH tunnel approach** (no new gateway service needed)
3. **Simple config file** edited by hand

```javascript
// MVP: Just modify bridge to accept env vars or config
// bridge/config.js
const USER_CONFIG_PATH = path.join(__dirname, '..', 'bridge-data', 'network.json');

function loadNetworkConfig() {
  try {
    return JSON.parse(fs.readFileSync(USER_CONFIG_PATH));
  } catch {
    return {
      printerIp: process.env.ARROW_PES_HOST || '192.168.1.115',
      printerPort: 22,
      username: 'root',
      sshKeyPath: path.join(os.homedir(), '.ssh', 'id_ed25519')
    };
  }
}
```

This gets you working **today** while we build the full UI.

## Security Considerations

1. **SSH Key Auth Only** — no passwords
2. **LAN Firewall** — gateway binds to 0.0.0.0 but only accept from local subnet
3. **HTTPS Option** — add TLS certificates for the gateway
4. **Rate Limiting** — prevent job spam

## Next Steps

Which phase do you want to start with?

- **Quick win:** MVP with hand-edited config (30 min)
- **Full implementation:** Week 1 starting with Settings UI
- **Alternative:** Research existing solutions (telepresence, kcp, etc.)
