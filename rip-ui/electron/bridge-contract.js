const { RipBackendError } = require('./rip-backend');

function nowIso() {
  return new Date().toISOString();
}

function toBridgeError(error) {
  if (error instanceof RipBackendError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details || {}
    };
  }

  return {
    code: 'UNEXPECTED_BRIDGE_ERROR',
    message: error?.message || 'Unexpected bridge error.',
    details: {}
  };
}

function createBridgeContract({ backend, logger = console }) {
  return {
    async getRuntimeConfig() {
      return backend.getRuntimeConfig();
    },

    async appendAudit(_event, entry) {
      try {
        return await backend.appendAudit(entry);
      } catch (error) {
        const bridgeError = toBridgeError(error);
        logger.error('[rip:append-audit] failed', bridgeError);
        return { ok: false, error: bridgeError, timestamp: nowIso() };
      }
    },

    async getStatus(_event, config) {
      try {
        return await backend.getStatus(config);
      } catch (error) {
        const bridgeError = toBridgeError(error);
        logger.error('[rip:status] failed', bridgeError);
        throw Object.assign(new Error(bridgeError.message), { bridgeError, timestamp: nowIso() });
      }
    },

    async runCommand(_event, payload) {
      try {
        return await backend.runCommand(payload);
      } catch (error) {
        const bridgeError = toBridgeError(error);
        logger.error('[rip:run-command] failed', { payload, ...bridgeError });
        throw Object.assign(new Error(bridgeError.message), { bridgeError, timestamp: nowIso() });
      }
    },

    async submitJob(_event, payload) {
      try {
        return await backend.submitJob(payload);
      } catch (error) {
        const bridgeError = toBridgeError(error);
        logger.error('[rip:submit-job] failed', { payload, ...bridgeError });
        throw Object.assign(new Error(bridgeError.message), { bridgeError, timestamp: nowIso() });
      }
    },

    async testEndpoint(_event, endpoint) {
      try {
        return await backend.testEndpoint(endpoint);
      } catch (error) {
        const bridgeError = toBridgeError(error);
        logger.error('[rip:test-endpoint] failed', { endpoint, ...bridgeError });
        return {
          ok: false,
          message: bridgeError.message,
          error: bridgeError,
          timestamp: nowIso()
        };
      }
    }
  };
}

module.exports = {
  createBridgeContract
};
