const { contextBridge, ipcRenderer } = require('electron');

const streamListeners = new Set();
let streamAttached = false;

function attachStreamListeners() {
  if (streamAttached) return;
  streamAttached = true;

  ipcRenderer.on('rip:status-stream:update', (_event, payload) => {
    streamListeners.forEach(listener => {
      try {
        listener({ type: 'update', payload });
      } catch {
        // Ignore listener exceptions to avoid breaking stream fanout.
      }
    });
  });

  ipcRenderer.on('rip:status-stream:open', (_event, payload) => {
    streamListeners.forEach(listener => {
      try {
        listener({ type: 'open', payload });
      } catch {
        // Ignore listener exceptions to avoid breaking stream fanout.
      }
    });
  });

  ipcRenderer.on('rip:status-stream:error', (_event, payload) => {
    streamListeners.forEach(listener => {
      try {
        listener({ type: 'error', payload });
      } catch {
        // Ignore listener exceptions to avoid breaking stream fanout.
      }
    });
  });
}

contextBridge.exposeInMainWorld('ripUiEnv', {
  appMode: 'offline-prototype',
  discoveryMode: 'read-only'
});

contextBridge.exposeInMainWorld('ripBridge', {
  getRuntimeConfig() {
    return ipcRenderer.invoke('rip:get-runtime-config');
  },
  getStatus(config) {
    return ipcRenderer.invoke('rip:get-status', config);
  },
  runCommand(payload) {
    return ipcRenderer.invoke('rip:run-command', payload);
  },
  testEndpoint(endpoint) {
    return ipcRenderer.invoke('rip:test-endpoint', endpoint);
  },
  ingestJob(payload) {
    return ipcRenderer.invoke('rip:ingest-job', payload);
  },
  sendQueuedJob(payload) {
    return ipcRenderer.invoke('rip:send-queued-job', payload);
  },
  submitJob(payload) {
    return ipcRenderer.invoke('rip:submit-job', payload);
  },
  appendAudit(entry) {
    return ipcRenderer.invoke('rip:append-audit', entry);
  },
  subscribeStatusStream(onEvent) {
    if (typeof onEvent !== 'function') return () => {};
    attachStreamListeners();
    streamListeners.add(onEvent);
    ipcRenderer.send('rip:status-stream:start');
    return () => {
      streamListeners.delete(onEvent);
      if (streamListeners.size === 0) {
        ipcRenderer.send('rip:status-stream:stop');
      }
    };
  },
  unsubscribeStatusStream() {
    streamListeners.clear();
    ipcRenderer.send('rip:status-stream:stop');
  }
});
