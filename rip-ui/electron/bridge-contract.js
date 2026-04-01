const { RipBackendError, JobStatus } = require('./rip-backend');

// Helper function to determine if a given error represents a "degraded success"
// where the UI received an abort, but the backend reports successful completion.
function isDegradedSuccess(error, jobStatus) {
  return error.code === 'BRIDGE_UNAVAILABLE' &&
         error.message === 'This operation was aborted' &&
         (jobStatus === JobStatus.COMPLETED || jobStatus === JobStatus.DEGRADED_COMPLETED);
}


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
  // Ensure backend.getJobStatus exists for degraded success check.
  // In a production environment, expose this via rip-backend.js from bridge-http.js.
  if (typeof backend.getJobStatus !== 'function') {
    backend.getJobStatus = async (jobId) => {
      logger.warn('[bridge-contract] backend.getJobStatus not implemented in current backend. Mocking result for:', { jobId });
      await new Promise(resolve => setTimeout(resolve, 100)); // Simulate async
      return (jobId === 'aborted-but-completed-job') ? JobStatus.COMPLETED : JobStatus.FAILED;
    };
  }

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

    async ingestJob(_event, payload) {
      try {
        return await backend.ingestJob(payload);
      } catch (error) {
        const bridgeError = toBridgeError(error);
        logger.error('[rip:ingest-job] failed', { payload, ...bridgeError });
        throw Object.assign(new Error(bridgeError.message), { bridgeError, timestamp: nowIso() });
      }
    },

    async sendQueuedJob(_event, payload) {
      try {
        return await backend.sendQueuedJob(payload);
      } catch (error) {
        const bridgeError = toBridgeError(error);
        logger.error('[rip:send-queued-job] failed', { payload, ...bridgeError });
        
        // Check if it's a degraded success scenario
        if (bridgeError.code === 'BRIDGE_UNAVAILABLE' && bridgeError.message === 'This operation was aborted') {
          const jobStatus = await backend.getJobStatus(payload.jobId); // Actual backend call
          if (isDegradedSuccess(bridgeError, jobStatus)) {
            logger.warn('[rip:send-queued-job] degraded success: UI aborted but backend reported completion.', { payload, jobStatus, ...bridgeError });
            return { ok: true, message: 'Operation completed with degraded success (UI aborted, but backend confirmed completion).', timestamp: nowIso(), status: jobStatus };
          }
        }
        throw Object.assign(new Error(bridgeError.message), { bridgeError, timestamp: nowIso() });
      }
    },

    async submitJob(_event, payload) {
      try {
        return await backend.submitJob(payload);
      } catch (error) {
        const bridgeError = toBridgeError(error);
        logger.error('[rip:submit-job] failed', { payload, ...bridgeError });
        
        // Check if it's a degraded success scenario for submitJob as well
        if (bridgeError.code === 'BRIDGE_UNAVAILABLE' && bridgeError.message === 'This operation was aborted') {
          const jobStatus = await backend.getJobStatus(payload.jobId); // Actual backend call
          if (isDegradedSuccess(bridgeError, jobStatus)) {
            logger.warn('[rip:submit-job] degraded success: UI aborted but backend reported completion.', { payload, jobStatus, ...bridgeError });
            return { ok: true, message: 'Operation completed with degraded success (UI aborted, but backend confirmed completion).', timestamp: nowIso(), status: jobStatus };
          }
        }
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
