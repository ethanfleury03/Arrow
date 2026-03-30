const ENGINE_STATE_VALUE_TO_NAME = Object.freeze({
  1: 'OFF',
  2: 'FAULT',
  3: 'TESTING',
  4: 'INITIALISING',
  5: 'DEPRIMED_IDLE',
  6: 'PRIMED_IDLE',
  7: 'SERVICING',
  8: 'PRE_JOB',
  9: 'PRINT_READY',
  10: 'PRINTING',
  11: 'MID_JOB',
  12: 'PAUSED',
  13: 'SESSION_COMPLETE',
  14: 'POST_JOB',
  15: 'SHUTTING_DOWN',
  16: 'PAUSING'
});

const ENGINE_STATE_NAME_TO_UI = Object.freeze({
  OFF: 'OFF',
  FAULT: 'FAULT',
  TESTING: 'IDLE',
  INITIALISING: 'IDLE',
  DEPRIMED_IDLE: 'READY',
  PRIMED_IDLE: 'READY',
  SERVICING: 'IDLE',
  PRE_JOB: 'READY',
  PRINT_READY: 'READY',
  PRINTING: 'PRINTING',
  MID_JOB: 'PRINTING',
  PAUSED: 'READY',
  SESSION_COMPLETE: 'READY',
  POST_JOB: 'IDLE',
  SHUTTING_DOWN: 'IDLE',
  PAUSING: 'PRINTING'
});

function parseEngineStateNumberFromRaw(text) {
  const src = String(text || '');
  if (!src) return null;
  const match = src.match(/engineStatus\s*[=.:]\s*[^\n\r]*?state\s*[=:]\s*(\d{1,3})/i)
    || src.match(/engineStatus\.state\s*[=:]\s*(\d{1,3})/i)
    || src.match(/\bstate\s*[=:]\s*(\d{1,3})\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) ? value : null;
}

function extractEmbeddedJsonRawFromOutput(text) {
  const src = String(text || '');
  if (!src) return null;

  const lines = src.split(/\r?\n/);
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed.raw === 'string' && parsed.raw.trim()) {
        return parsed.raw;
      }
    } catch {}
  }

  return null;
}

function hasSimulatedSignal(value, depth = 0) {
  if (depth > 4 || value == null) return false;

  if (typeof value === 'boolean') return value === true;

  if (typeof value === 'string') {
    const src = value.trim().toLowerCase();
    return src.includes('simulat') || src.includes('shim') || src.includes('no-op') || src.includes('noop') || src.includes('dry-run') || src.includes('dry run');
  }

  if (Array.isArray(value)) {
    return value.some(item => hasSimulatedSignal(item, depth + 1));
  }

  if (typeof value === 'object') {
    if (value.simulated === true || value.shim === true || value.noop === true || value.noOp === true || value.dryRun === true) {
      return true;
    }

    return Object.entries(value).some(([key, val]) => {
      const keyLc = String(key || '').toLowerCase();
      if (['simulated', 'shim', 'noop', 'dryrun', 'dry_run'].includes(keyLc)) {
        return hasSimulatedSignal(val, depth + 1);
      }
      if (['message', 'reason', 'note', 'status', 'resultrepr', 'output', 'rawstdout', 'rawstderr'].includes(keyLc)) {
        return hasSimulatedSignal(val, depth + 1);
      }
      return false;
    });
  }

  return false;
}

function resolveEngineState(status = {}) {
  const details = status?.details || {};
  const productInfo = details?.productInfo || {};

  const directNamedCandidates = [
    ['status.engineStateRawLabel', status?.engineStateRawLabel],
    ['details.engineStateRawLabel', details?.engineStateRawLabel],
    ['status.engineState', status?.engineState],
    ['details.engineState', details?.engineState],
    ['details.engine', details?.engine],
    ['productInfo.engineState', productInfo?.engineState],
    ['productInfo.engine', productInfo?.engine],
    ['productInfo.status.engineState', productInfo?.status?.engineState],
    ['productInfo.status.engine', productInfo?.status?.engine],
    ['productInfo.status.state', productInfo?.status?.state],
    ['productInfo.state', productInfo?.state]
  ];

  let extraction = 'unknown';
  let rawLabel = '';
  let numeric = null;

  // If engineStateRawNumeric is provided directly, use it and look up the mapped name
  if (Number.isInteger(status?.engineStateRawNumeric)) {
    numeric = Number(status.engineStateRawNumeric);
    rawLabel = ENGINE_STATE_VALUE_TO_NAME[numeric] || '';
    if (numeric != null) {
      extraction = 'status.engineStateRawNumeric';
    }
  }

  for (const [source, value] of directNamedCandidates) {
    if (typeof value === 'string' && value.trim()) {
      const candidate = value.trim().toUpperCase();
      if (candidate !== 'UNKNOWN') {
        rawLabel = candidate;
        extraction = source;
        break;
      }
    }
    if (typeof value === 'number' && Number.isInteger(value)) {
      numeric = value;
      rawLabel = ENGINE_STATE_VALUE_TO_NAME[value] || '';
      extraction = `${source}:numeric`;
      if (rawLabel) break;
    }
  }

  if (!rawLabel) {
    const embeddedRaw = extractEmbeddedJsonRawFromOutput(productInfo?.output);
    if (embeddedRaw) {
      const parsed = parseEngineStateNumberFromRaw(embeddedRaw);
      if (parsed != null) {
        numeric = parsed;
        rawLabel = ENGINE_STATE_VALUE_TO_NAME[parsed] || '';
        extraction = 'productInfo.output.embeddedJson.raw:regex';
      }
    }

    if (!rawLabel) {
      const rawTextCandidates = [
        ['productInfo.output', productInfo?.output],
        ['productInfo.resultRepr', productInfo?.resultRepr],
        ['productInfo.rawStdout', productInfo?.rawStdout],
        ['productInfo.raw', productInfo?.raw],
        ['details.raw', details?.raw],
        ['status.raw', status?.raw],
        ['status.output', status?.output],
        ['details.output', details?.output]
      ];
      for (const [source, raw] of rawTextCandidates) {
        const parsed = parseEngineStateNumberFromRaw(raw);
        if (parsed != null) {
          numeric = parsed;
          rawLabel = ENGINE_STATE_VALUE_TO_NAME[parsed] || '';
          extraction = `${source}:regex`;
          break;
        }
      }
    }
  }

  if (!rawLabel && numeric == null) {
    const serialized = JSON.stringify(status || {});
    const parsed = parseEngineStateNumberFromRaw(serialized);
    if (parsed != null) {
      numeric = parsed;
      rawLabel = ENGINE_STATE_VALUE_TO_NAME[parsed] || '';
      extraction = 'status.serialized:regex';
    }
  }

  const canonical = rawLabel || (numeric != null ? ENGINE_STATE_VALUE_TO_NAME[numeric] || '' : '');
  const canonicalUi = ENGINE_STATE_NAME_TO_UI[canonical] || (canonical || 'UNKNOWN');
  const displayRawLabel = rawLabel || (numeric != null ? `STATE_${numeric}` : 'UNKNOWN');

  return {
    numeric,
    rawLabel: displayRawLabel,
    canonical: canonical || null,
    engineState: canonicalUi || 'UNKNOWN',
    extraction
  };
}

module.exports = {
  ENGINE_STATE_VALUE_TO_NAME,
  ENGINE_STATE_NAME_TO_UI,
  parseEngineStateNumberFromRaw,
  extractEmbeddedJsonRawFromOutput,
  hasSimulatedSignal,
  resolveEngineState
};
