const assert = require('node:assert/strict');
const http = require('node:http');
const { createRipBackend } = require('../electron/rip-backend');

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await run(port);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function run() {
  let statusCallCount = 0;
  await withServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/device/status') {
      statusCallCount += 1;
      const outputPayload = statusCallCount === 1
        ? [
          'wrapper line 1',
          '{"raw":"AllStatus(foo=1, engineStatus=EngineStatus(state=6, isReadyForPrintData=true))","other":"x"}',
          'wrapper line 3'
        ].join('\n')
        : [
          'wrapper line A',
          '{"raw":"AllStatus(foo=1, engineStatus=EngineStatus(state=7, isReadyForPrintData=true))","other":"y"}',
          'wrapper line B'
        ].join('\n');

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        engine: 'idle',
        details: {
          queueLength: 2,
          productInfo: {
            output: outputPayload
          }
        },
        lastUpdate: new Date().toISOString()
      }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/device/run-command') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: true, command: 'print_prepare', source: 'bridge-http' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }, async port => {
    const originalDebug = process.env.RIP_STATUS_DEBUG;
    process.env.RIP_STATUS_DEBUG = '1';

    const detailLogs = [];
    const backend = createRipBackend({
      mode: 'bridge-http',
      runtimeConfig: { bridgeHost: '127.0.0.1', bridgePort: port },
      logger: {
        info(...args) { detailLogs.push(args); },
        warn() {},
        error() {}
      }
    });

    try {
      const statusA = await backend.getStatus({ host: '127.0.0.1', commandPort: 13002 });
      assert.equal(statusA.engineState, 'READY');
      assert.equal(statusA.engineStateRawNumeric, 6);
      assert.equal(statusA.engineStateRawLabel, 'PRIMED_IDLE');
      assert.equal(statusA.engineStateCanonical, 'PRIMED_IDLE');

      const statusB = await backend.getStatus({ host: '127.0.0.1', commandPort: 13002 });
      assert.equal(statusB.engineState, 'IDLE');
      assert.equal(statusB.engineStateRawNumeric, 7);
      assert.equal(statusB.engineStateRawLabel, 'SERVICING');
      assert.equal(statusB.engineStateCanonical, 'SERVICING');

      const detailPayloads = detailLogs
        .map(parts => parts.find(part => part && typeof part === 'object' && !Array.isArray(part)))
        .filter(Boolean);

      assert.ok(detailPayloads.some(entry => (
        entry.extraction === 'productInfo.output.embeddedJson.raw:regex' &&
        entry.extractedNumeric === 6 &&
        entry.rawEngineState === 'PRIMED_IDLE' &&
        entry.mappedEngineState === 'READY'
      )));
      assert.ok(detailPayloads.some(entry => (
        entry.extraction === 'productInfo.output.embeddedJson.raw:regex' &&
        entry.extractedNumeric === 7 &&
        entry.rawEngineState === 'SERVICING' &&
        entry.mappedEngineState === 'IDLE'
      )));

      const result = await backend.runCommand({ command: 'print_prepare', config: { host: '127.0.0.1', commandPort: 13002 } });
      assert.equal(result.accepted, true);
    } finally {
      if (typeof originalDebug === 'string') process.env.RIP_STATUS_DEBUG = originalDebug;
      else delete process.env.RIP_STATUS_DEBUG;
    }
  });

  await withServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/device/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        details: {
          queueLength: 0,
          productInfo: {
            output: '{"raw":"AllStatus(engineStatus=EngineStatus(state=99, isReadyForPrintData=false))"}'
          }
        },
        lastUpdate: new Date().toISOString()
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }, async port => {
    const backend = createRipBackend({
      mode: 'bridge-http',
      runtimeConfig: { bridgeHost: '127.0.0.1', bridgePort: port },
      logger: { warn() {}, error() {} }
    });

    const unknownStatus = await backend.getStatus({ host: '127.0.0.1', commandPort: 13002 });
    assert.equal(unknownStatus.engineStateRawNumeric, 99);
    assert.equal(unknownStatus.engineStateRawLabel, 'STATE_99');
    assert.equal(unknownStatus.engineState, 'UNKNOWN');
  });

  await withServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/device/run-command') {
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        accepted: false,
        error: 'simulated_response_rejected',
        message: 'simulated rejected by bridge'
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }, async port => {
    const backend = createRipBackend({
      mode: 'bridge-http',
      runtimeConfig: { bridgeHost: '127.0.0.1', bridgePort: port },
      logger: { warn() {}, error() {} }
    });

    await assert.rejects(
      () => backend.runCommand({ command: 'print_prepare', config: { host: '127.0.0.1', commandPort: 13002 } }),
      error => error.code === 'COMMAND_REJECTED_SIMULATED'
    );
  });

  await withServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/jobs/ingest') {
      let body = '';
      req.on('data', chunk => { body += String(chunk); });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        assert.equal(parsed.filePath, '/tmp/mock-job.pdf');
        assert.equal(parsed.copies, 3);
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jobId: 'JOB_BRIDGE_001', state: 'validated' }));
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/jobs/JOB_BRIDGE_001/send') {
      let body = '';
      req.on('data', chunk => { body += String(chunk); });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        assert.equal(parsed.copies, 3);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jobId: 'JOB_BRIDGE_001', state: 'completed' }));
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }, async port => {
    const backend = createRipBackend({
      mode: 'bridge-http',
      runtimeConfig: { bridgeHost: '127.0.0.1', bridgePort: port },
      logger: { warn() {}, error() {} }
    });

    const result = await backend.submitJob({
      jobId: 'LOCAL_JOB_123',
      inputPath: '/tmp/mock-job.pdf',
      args: ['--copies', '3'],
      config: { host: '127.0.0.1', commandPort: 13002 },
      settings: { inputPath: '/tmp/mock-job.pdf' }
    });

    assert.equal(result.accepted, true);
    assert.equal(result.jobId, 'JOB_BRIDGE_001');
    assert.equal(result.status, 'completed');
  });

  await withServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/jobs/ingest') {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jobId: 'JOB_BRIDGE_FAIL_001', state: 'validated' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/jobs/JOB_BRIDGE_FAIL_001/send') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'adapter_unavailable',
        message: 'Real Memjet adapter unavailable.'
      }));
      return;
    }

    if (req.method === 'POST' && req.url === '/jobs') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unexpected_fallback_call' }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }, async port => {
    const backend = createRipBackend({
      mode: 'bridge-http',
      runtimeConfig: {
        bridgeHost: '127.0.0.1',
        bridgePort: port,
        adapterHost: '127.0.0.1',
        adapterPort: port
      },
      logger: { warn() {}, error() {} }
    });

    await assert.rejects(
      () => backend.submitJob({
        jobId: 'LOCAL_JOB_FAIL_123',
        inputPath: '/tmp/mock-job.pdf',
        config: { host: '127.0.0.1', commandPort: 13002 },
        settings: { inputPath: '/tmp/mock-job.pdf' }
      }),
      error => error.code === 'BRIDGE_UNAVAILABLE' && /\/api\/jobs\/JOB_BRIDGE_FAIL_001\/send/i.test(error.message)
    );
  });

  const unavailable = createRipBackend({
    mode: 'bridge-http',
    runtimeConfig: { bridgeHost: '127.0.0.1', bridgePort: 1 },
    logger: { warn() {}, error() {} }
  });

  await assert.rejects(
    () => unavailable.getStatus({ host: '127.0.0.1', commandPort: 13002 }),
    error => error.code === 'BRIDGE_UNAVAILABLE'
  );

  console.log('rip-backend.test: PASS');
}

run().catch(error => {
  console.error('rip-backend.test: FAIL');
  console.error(error);
  process.exit(1);
});