const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createBridgeContract } = require('./bridge-contract');
const { createRipBackend } = require('./rip-backend');
const { loadRuntimeConfig } = require('./runtime-config');

const runtimeConfig = loadRuntimeConfig();
const backend = createRipBackend({ mode: runtimeConfig.backendMode, runtimeConfig, userDataPath: app.getPath('userData') });
const bridgeContract = createBridgeContract({ backend, logger: console });

const statusStreams = new Map();

function statusStreamUrl() {
  const host = String(runtimeConfig.bridgeHost || '127.0.0.1').trim();
  const port = Number(runtimeConfig.bridgePort || 8787);
  return `http://${host}:${port}/api/device/status/stream`;
}

function stopStatusStream(webContentsId) {
  const stream = statusStreams.get(webContentsId);
  if (!stream) return;

  if (stream.reconnectTimer) {
    clearTimeout(stream.reconnectTimer);
    stream.reconnectTimer = null;
  }
  if (stream.eventSource) {
    stream.eventSource.close();
    stream.eventSource = null;
  }
  statusStreams.delete(webContentsId);
}

function startStatusStream(sender) {
  const webContentsId = sender.id;
  stopStatusStream(webContentsId);

  const stream = {
    eventSource: null,
    reconnectTimer: null,
    retries: 0,
    closed: false
  };
  statusStreams.set(webContentsId, stream);

  const connect = () => {
    if (stream.closed) return;

    let es;
    try {
      es = new EventSource(statusStreamUrl());
    } catch (error) {
      sender.send('rip:status-stream:error', {
        message: `Failed to create EventSource: ${error.message}`,
        timestamp: new Date().toISOString()
      });
      stream.reconnectTimer = setTimeout(connect, 2000);
      return;
    }

    stream.eventSource = es;

    es.addEventListener('open', () => {
      stream.retries = 0;
      sender.send('rip:status-stream:open', {
        source: 'bridge-sse',
        timestamp: new Date().toISOString()
      });
    });

    es.addEventListener('system-state', event => {
      try {
        const payload = JSON.parse(event.data || '{}');
        sender.send('rip:status-stream:update', payload);
      } catch (error) {
        sender.send('rip:status-stream:error', {
          message: `Invalid status stream payload: ${error.message}`,
          timestamp: new Date().toISOString()
        });
      }
    });

    es.onerror = () => {
      if (stream.closed) return;
      es.close();
      stream.eventSource = null;
      stream.retries += 1;
      const delay = Math.min(10000, 1000 * Math.max(1, stream.retries));
      sender.send('rip:status-stream:error', {
        message: `Status stream disconnected. Reconnecting in ${delay}ms.`,
        retryInMs: delay,
        retries: stream.retries,
        timestamp: new Date().toISOString()
      });
      stream.reconnectTimer = setTimeout(connect, delay);
    };
  };

  connect();
}

function registerBridgeHandlers() {
  ipcMain.handle('rip:get-runtime-config', bridgeContract.getRuntimeConfig);
  ipcMain.handle('rip:get-status', bridgeContract.getStatus);
  ipcMain.handle('rip:run-command', bridgeContract.runCommand);
  ipcMain.handle('rip:test-endpoint', bridgeContract.testEndpoint);
  ipcMain.handle('rip:submit-job', bridgeContract.submitJob);
  ipcMain.handle('rip:append-audit', bridgeContract.appendAudit);

  ipcMain.on('rip:status-stream:start', event => {
    startStatusStream(event.sender);
  });

  ipcMain.on('rip:status-stream:stop', event => {
    stopStatusStream(event.sender.id);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    title: 'RIP UI Prototype',
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [
        `--rip-profile=${runtimeConfig.operatorProfile}`,
        `--rip-backend=${runtimeConfig.backendMode}`
      ]
    }
  });

  win.webContents.on('destroyed', () => {
    stopStatusStream(win.webContents.id);
  });

  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

app.whenReady().then(() => {
  registerBridgeHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
