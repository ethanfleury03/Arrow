const STORAGE_KEY = 'rip-ui-prototype-state-v1';
const DESIGNS_STORAGE_KEY = 'rip-ui-prototype-3d-designs-v1';
const MAX_DESIGN_LABEL_FILE_BYTES = 2 * 1024 * 1024;

const OBJECT_TEMPLATE_REGISTRY = [
  { id: 'box', label: 'Box' }
];
const DEFAULT_OBJECT_TEMPLATE_ID = OBJECT_TEMPLATE_REGISTRY[0]?.id || 'box';

const BOX_FACE_MAP = Object.freeze([
  { id: 1, name: 'Front', materialIndex: 4, normal: [0, 0, 1], uAxis: [1, 0, 0], vAxis: [0, 1, 0] },
  { id: 2, name: 'Back', materialIndex: 5, normal: [0, 0, -1], uAxis: [-1, 0, 0], vAxis: [0, 1, 0] },
  { id: 3, name: 'Left', materialIndex: 1, normal: [-1, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0] },
  { id: 4, name: 'Right', materialIndex: 0, normal: [1, 0, 0], uAxis: [0, 0, -1], vAxis: [0, 1, 0] },
  { id: 5, name: 'Top', materialIndex: 2, normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, -1] },
  { id: 6, name: 'Bottom', materialIndex: 3, normal: [0, -1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1] }
]);

const FACE_MAP_BY_TEMPLATE = Object.freeze({
  box: BOX_FACE_MAP
});

const INITIAL_STATE = {
  seed: 42,
  counter: 2,
  jobs: [
    { id: 'JOB-0001', name: 'label_sheet_A.pdf', status: 'queued' },
    { id: 'JOB-0002', name: 'test_patch_v2.pdf', status: 'held' }
  ],
  queue: [],
  status: {
    engine: 'IDLE',
    connection: 'OFFLINE-MOCK',
    queueDepth: 2,
    discovery: 'READY',
    pipeline: 'WAITING',
    sequenceStep: '0/6'
  },
  simulator: {
    expected: ['clear', 'initialise', 'prepare', 'start', 'finish', 'shutdown'],
    stepIndex: 0,
    lastResult: 'NOT-RUN',
    running: false,
    history: []
  },
  config: {
    environment: 'windows-host-test',
    operatorProfile: 'live-operator',
    backendMode: 'bridge-http',
    host: '127.0.0.1',
    commandPort: 13002,
    eventPort: 9231,
    dataPort: 13001,
    readOnlyDiscovery: false,
    intendedSpeedIps: 120,
    pollIntervalMs: 1000,
    bridgeHost: '127.0.0.1',
    bridgePort: 8787,
    bridgeBaseUrl: 'http://127.0.0.1:8787',
    adapterHost: '127.0.0.1',
    adapterPort: 8081
  },
  connectionTests: {
    command: 'NOT-TESTED',
    event: 'NOT-TESTED',
    data: 'NOT-TESTED'
  },
  liveStatus: {
    engineState: 'UNKNOWN',
    engineStateRawNumeric: null,
    engineStateRawLabel: 'UNKNOWN',
    engineStateCanonical: 'UNKNOWN',
    queueLength: 0,
    faults: [],
    lastUpdate: null,
    source: 'bridge-http',
    running: false,
    inkLevels: { C: 0, M: 0, Y: 0, K: 0 }
  },
  artwork: {
    loaded: false,
    name: '',
    inputPath: '',
    pageWidthPt: 612,
    pageHeightPt: 792,
    previewDataUrl: '',
    placement: {
      mediaWidthMm: 330,
      mediaHeightMm: 482,
      alignX: 'center',
      alignY: 'middle',
      // Optional UI-only placeholder for future cut/printable-height integration.
      // If null/missing, full media height is treated as printable.
      printableHeightMm: null,
      offsetXmm: 0,
      offsetYmm: 0,
      scalePercent: 100,
      rotationDeg: 0,
      fitMode: 'none',
      pageSizePreset: '13x19',
      orientation: 'portrait',
      flipHorizontal: false,
      flipVertical: false
    }
  },
  preflight: {
    passed: false,
    lastRun: null,
    reasons: ['Run preflight checks before starting live print.']
  },
  submission: {
    lastJobId: null,
    lastResult: 'NOT-RUN'
  },
  audit: {
    entries: [],
    retentionMaxEntries: 80,
    filterType: 'all'
  },
  controls: {
    autoSendEnabled: false
  },
  logs: [],
  ui: {
    topTab: 'printhead',
    leftSidebarTab: 'artwork',
    rightSidebarTab: 'live',
    jobArrangeTab: 'arrange',
    arrange: {
      gapHorizontalMm: 0,
      gapVerticalMm: 0,
      copyHorizontalCount: 1,
      copyVerticalCount: 1,
      copyHorizontalSpacingMm: 0,
      copyVerticalSpacingMm: 0,
      copyIntervalIncludesSize: false
    }
  }
};

let state = loadState();
let renderTick = 0;
let layoutPreviewImage = null;
let layoutPreviewImageSrc = '';
const JOB_NUMERIC_EDITING_IDS = new Set();
const MIN_VISIBLE_QUEUE_ROWS = 12;
const COMMANDS = [
  { name: 'clean_light', mutating: true, label: 'Light clean', priority: 'secondary' },
  { name: 'clean_medium', mutating: true, label: 'Medium clean', priority: 'secondary' },
  { name: 'clean_heavy', mutating: true, label: 'Heavy clean', priority: 'secondary' },
  { name: 'engine_initialise', mutating: true, label: 'Initialise', priority: 'secondary' },
  { name: 'engine_shutdown', mutating: true, label: 'Shutdown', priority: 'secondary' },
  { name: 'engine_replace_wipers', mutating: true, label: 'Replace Wipers', priority: 'secondary' },
  { name: 'prime_begin', mutating: true, label: 'Begin Priming', priority: 'secondary' },
  { name: 'deprime_begin', mutating: true, label: 'Begin Depriming', priority: 'secondary' },
  { name: 'head_cap', mutating: true, label: 'Cap', priority: 'secondary' },
  { name: 'head_raise', mutating: true, label: 'Raise', priority: 'secondary' },
  { name: 'head_print', mutating: true, label: 'Print', priority: 'secondary' },
  { name: 'print_prepare', mutating: true, label: 'Prepare to Print', priority: 'primary' },
  { name: 'print_pause', mutating: true, label: 'Pause', priority: 'secondary' },
  { name: 'print_start', mutating: true, label: 'Start Print', priority: 'primary' },
  { name: 'print_finish', mutating: true, label: 'Finish Printing', priority: 'primary' }
];

const UI_COMMAND_SIM_MAP = {
  clean_light: 'clear',
  clean_medium: 'initialise',
  clean_heavy: 'shutdown',
  engine_initialise: 'initialise',
  engine_shutdown: 'shutdown',
  engine_replace_wipers: 'clear',
  prime_begin: 'prepare',
  deprime_begin: 'shutdown',
  head_cap: 'finish',
  head_raise: 'prepare',
  head_print: 'start',
  print_prepare: 'prepare',
  print_pause: 'shutdown',
  print_start: 'start',
  print_finish: 'finish'
};
const READ_ONLY_ACTIONS = [
  { id: 'btnTestCommand', label: 'Test Command' },
  { id: 'btnTestEvent', label: 'Test Event' },
  { id: 'btnTestData', label: 'Test Data' },
  { id: 'btnDiscover', label: 'Run Discovery Scan' }
];

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const MM_PER_IN = 25.4;
const PAGE_SIZE_PRESETS = {
  letter: { widthIn: 8.5, heightIn: 11 },
  legal: { widthIn: 8.5, heightIn: 14 },
  tabloid: { widthIn: 11, heightIn: 17 },
  a4: { widthMm: 210, heightMm: 297 },
  a3: { widthMm: 297, heightMm: 420 },
  '12x18': { widthIn: 12, heightIn: 18 },
  '13x19': { widthIn: 13, heightIn: 19 }
};
const PAGE_SIZE_MATCH_TOLERANCE_MM = 0.8;

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function mmToIn(mm) {
  return Number(mm) / MM_PER_IN;
}

function inToMm(inches) {
  return Number(inches) * MM_PER_IN;
}

function formatInchesForInput(mmValue) {
  return mmToIn(mmValue).toFixed(2);
}

function getPresetDimensionsMm(preset) {
  const def = PAGE_SIZE_PRESETS[preset];
  if (!def) return null;
  return {
    widthMm: Number.isFinite(def.widthMm) ? def.widthMm : inToMm(def.widthIn),
    heightMm: Number.isFinite(def.heightMm) ? def.heightMm : inToMm(def.heightIn)
  };
}

function getPresetDimensionsForOrientation(preset, orientation) {
  const dims = getPresetDimensionsMm(preset);
  if (!dims) return null;
  const isLandscape = orientation === 'landscape';
  return isLandscape
    ? { widthMm: Math.max(dims.widthMm, dims.heightMm), heightMm: Math.min(dims.widthMm, dims.heightMm) }
    : { widthMm: Math.min(dims.widthMm, dims.heightMm), heightMm: Math.max(dims.widthMm, dims.heightMm) };
}

function inferPresetAndOrientation(widthMm, heightMm) {
  const width = Number(widthMm);
  const height = Number(heightMm);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { pageSizePreset: 'custom', orientation: 'portrait' };
  }

  for (const preset of Object.keys(PAGE_SIZE_PRESETS)) {
    const portrait = getPresetDimensionsForOrientation(preset, 'portrait');
    const landscape = getPresetDimensionsForOrientation(preset, 'landscape');
    if (
      portrait
      && Math.abs(width - portrait.widthMm) <= PAGE_SIZE_MATCH_TOLERANCE_MM
      && Math.abs(height - portrait.heightMm) <= PAGE_SIZE_MATCH_TOLERANCE_MM
    ) {
      return { pageSizePreset: preset, orientation: 'portrait' };
    }
    if (
      landscape
      && Math.abs(width - landscape.widthMm) <= PAGE_SIZE_MATCH_TOLERANCE_MM
      && Math.abs(height - landscape.heightMm) <= PAGE_SIZE_MATCH_TOLERANCE_MM
    ) {
      return { pageSizePreset: preset, orientation: 'landscape' };
    }
  }

  return { pageSizePreset: 'custom', orientation: width > height ? 'landscape' : 'portrait' };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mergePlacement(parsedPlacement = {}) {
  const merged = { ...INITIAL_STATE.artwork.placement, ...parsedPlacement };
  const inferred = inferPresetAndOrientation(merged.mediaWidthMm, merged.mediaHeightMm);
  const preset = merged.pageSizePreset || inferred.pageSizePreset;
  merged.pageSizePreset = preset === 'custom' || PAGE_SIZE_PRESETS[preset] ? preset : inferred.pageSizePreset;
  merged.orientation = merged.orientation === 'landscape' ? 'landscape' : (merged.orientation === 'portrait' ? 'portrait' : inferred.orientation);
  return merged;
}

function isLocalStorageAvailable() {
  try {
    if (!localStorage) return false;
    const probeKey = '__rip_ui_probe__';
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

function readJsonFromStorage(key, fallback) {
  if (!isLocalStorageAvailable()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonToStorage(key, value) {
  if (!isLocalStorageAvailable()) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value, null, 2));
    return true;
  } catch {
    return false;
  }
}

function loadState() {
  try {
    const raw = isLocalStorageAvailable() ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return deepClone(INITIAL_STATE);
    const parsed = JSON.parse(raw);
    const parsedArtwork = parsed.artwork || {};

    return {
      ...deepClone(INITIAL_STATE),
      ...parsed,
      status: { ...INITIAL_STATE.status, ...(parsed.status || {}) },
      simulator: { ...INITIAL_STATE.simulator, ...(parsed.simulator || {}) },
      config: { ...INITIAL_STATE.config, ...(parsed.config || {}) },
      connectionTests: { ...INITIAL_STATE.connectionTests, ...(parsed.connectionTests || {}) },
      liveStatus: { ...INITIAL_STATE.liveStatus, ...(parsed.liveStatus || {}) },
      preflight: { ...INITIAL_STATE.preflight, ...(parsed.preflight || {}) },
      submission: { ...INITIAL_STATE.submission, ...(parsed.submission || {}) },
      audit: { ...INITIAL_STATE.audit, ...(parsed.audit || {}) },
      controls: { ...INITIAL_STATE.controls, ...(parsed.controls || {}) },
      ui: {
        ...INITIAL_STATE.ui,
        ...(parsed.ui || {}),
        arrange: {
          ...INITIAL_STATE.ui.arrange,
          ...(parsed.ui?.arrange || {})
        }
      },
      artwork: {
        ...INITIAL_STATE.artwork,
        ...parsedArtwork,
        placement: mergePlacement(parsedArtwork.placement)
      }
    };
  } catch {
    return deepClone(INITIAL_STATE);
  }
}

function persistState() {
  writeJsonToStorage(STORAGE_KEY, state);
}

function log(message) {
  const stamp = new Date().toISOString();
  state.logs.unshift(`[${stamp}] ${message}`);
  state.logs = state.logs.slice(0, 150);
  const logsEl = document.getElementById('logs');
  if (logsEl) logsEl.textContent = state.logs.join('\n');
  persistState();
}

function getActionableError(error) {
  const bridge = error?.bridgeError || error?.error;
  const code = bridge?.code || 'UNEXPECTED';
  const detailText = bridge?.details ? JSON.stringify(bridge.details) : '';
  const message = bridge?.message || error?.message || 'Unknown backend error.';
  return `${code}: ${message}${detailText ? ` | details=${detailText}` : ''}`;
}

function hasSimulatedSignal(value, depth = 0) {
  if (depth > 4 || value == null) return false;

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

    return Object.values(value).some(item => hasSimulatedSignal(item, depth + 1));
  }

  return false;
}

function generateJobId() {
  return `JOB-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`.toUpperCase();
}

async function appendAudit(entry) {
  const bridge = getBridge();
  const row = {
    timestamp: new Date().toISOString(),
    operatorProfile: state.config.operatorProfile,
    backendMode: state.config.backendMode,
    ...entry
  };
  state.audit.entries.unshift(row);
  const maxEntries = clamp(state.audit?.retentionMaxEntries, 10, 1000, 80);
  state.audit.retentionMaxEntries = maxEntries;
  state.audit.entries = state.audit.entries.slice(0, maxEntries);

  if (bridge && typeof bridge.appendAudit === 'function') {
    try {
      await bridge.appendAudit(row);
    } catch {
      // local log still preserved; backend write is best-effort only.
    }
  }
}

function isPreflightReadyEngineState(engineStateRaw) {
  const engineState = String(engineStateRaw || 'UNKNOWN').toUpperCase();
  return ['READY', 'IDLE', 'PRINTING'].includes(engineState);
}

function getStatusFreshnessMs() {
  const base = Number(state.config.pollIntervalMs || 1000);
  return Math.max(5000, base * 3);
}

function runPreflightChecks() {
  const reasons = [];
  if (!state.liveStatus.running) reasons.push('Status polling is not running.');
  if (!state.artwork.loaded) reasons.push('No PDF/artwork loaded.');
  if (!String(state.config.host || '').trim()) reasons.push('Host is not configured.');
  if (state.connectionTests.command.startsWith('FAILED') || state.connectionTests.command === 'NOT-TESTED') {
    reasons.push('Command endpoint test not passing.');
  }
  if (state.connectionTests.data.startsWith('FAILED') || state.connectionTests.data === 'NOT-TESTED') {
    reasons.push('Data endpoint test not passing.');
  }

  const statusAgeMs = state.liveStatus.lastUpdate ? Date.now() - Date.parse(state.liveStatus.lastUpdate) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(statusAgeMs) || statusAgeMs > getStatusFreshnessMs()) {
    reasons.push('Live status is stale; refresh polling and retry preflight.');
  }

  if (!isPreflightReadyEngineState(state.liveStatus.engineState)) {
    reasons.push(`Engine state not ready for preflight: ${state.liveStatus.engineState || 'UNKNOWN'}.`);
  }

  if (Array.isArray(state.liveStatus.faults) && state.liveStatus.faults.length > 0) {
    reasons.push(`Live status reports active faults: ${state.liveStatus.faults.join(', ')}.`);
  }

  state.preflight = {
    passed: reasons.length === 0,
    reasons,
    lastRun: new Date().toISOString()
  };

  appendAudit({ type: 'preflight', result: state.preflight });
  log(
    state.preflight.passed
      ? 'Preflight passed: live print path enabled.'
      : `Preflight failed: ${reasons.join(' | ')}`
  );
  render();
  persistState();
}

async function submitDataPlaneJob() {
  const bridge = getBridge();
  const jobId = generateJobId();
  const payload = {
    jobId,
    fileName: state.artwork.name || null,
    inputPath: state.artwork.inputPath || null,
    config: state.config,
    settings: {
      ...deepClone(state.artwork.placement),
      inputPath: state.artwork.inputPath || null
    }
  };

  if (!bridge || typeof bridge.submitJob !== 'function') {
    state.submission.lastResult = 'NOT-CONFIGURED';
    state.submission.lastJobId = jobId;
    log('Data-plane submit hook not available in this runtime.');
    return;
  }

  if (!payload.inputPath) {
    state.submission.lastResult = 'ERROR: Missing local file path. Load artwork from disk in Electron and retry.';
    state.submission.lastJobId = jobId;
    log('Submission blocked: no local input path available for RIP adapter.');
    render();
    persistState();
    return;
  }

  try {
    const result = await bridge.submitJob(payload);
    state.submission.lastJobId = jobId;
    state.submission.lastResult = result.accepted ? 'SUBMITTED' : `REJECTED: ${result.message || result.status}`;
    log(`Data-plane submission ${result.accepted ? 'accepted' : 'not accepted'} for ${jobId}: ${result.message || result.status}`);
    await appendAudit({ type: 'submit-job', payload, result });
    render();
    persistState();
  } catch (error) {
    const actionable = getActionableError(error);
    state.submission.lastJobId = jobId;
    state.submission.lastResult = `ERROR: ${actionable}`;
    log(`Data-plane submission error for ${jobId}: ${actionable}`);
    await appendAudit({ type: 'submit-job', payload, error: actionable });
    render();
    persistState();
  }
}

function updateSequenceStatus() {
  const max = state.simulator.expected.length;
  state.status.sequenceStep = `${Math.min(state.simulator.stepIndex, max)}/${max}`;

  if (state.simulator.lastResult.startsWith('PASS-RECOVERY')) {
    state.status.pipeline = 'RECOVERED';
  } else if (state.simulator.lastResult.startsWith('PASS')) {
    state.status.pipeline = 'VALIDATED';
  } else if (state.simulator.lastResult.startsWith('FAIL')) {
    state.status.pipeline = 'INVALID-SEQUENCE';
  } else if (state.simulator.running) {
    state.status.pipeline = 'SIMULATING';
  } else {
    state.status.pipeline = 'WAITING';
  }
}

function getArtworkBaseMm() {
  return {
    width: Math.max(1, (state.artwork.pageWidthPt / 72) * MM_PER_IN),
    height: Math.max(1, (state.artwork.pageHeightPt / 72) * MM_PER_IN)
  };
}

function computePlacedArtworkMm() {
  const p = state.artwork.placement;
  const base = getArtworkBaseMm();
  const scale = Math.max(0.01, p.scalePercent / 100);
  return {
    width: base.width * scale,
    height: base.height * scale
  };
}

function getPrintableHeightMm(mediaHeightMm) {
  const selectedJob = state.jobs.find(job => job.id === state.ui?.selectedJobId) || null;
  // Prefer explicit job-level printable/cut height if present; otherwise placement-level placeholder.
  const candidate = Number(
    selectedJob?.printableHeightMm
      ?? selectedJob?.cutHeightMm
      ?? state.artwork?.placement?.printableHeightMm
  );

  if (Number.isFinite(candidate) && candidate > 0) {
    return clamp(candidate, 1, mediaHeightMm, mediaHeightMm);
  }

  return mediaHeightMm;
}

function computeArtworkBoxPx(containerWmm, containerHmm, mmToPx) {
  const p = state.artwork.placement;
  const base = getArtworkBaseMm();
  const baseRatio = base.width / base.height;
  const containerRatio = containerWmm / Math.max(1, containerHmm);

  let targetWmm = base.width;
  let targetHmm = base.height;

  if (p.fitMode === 'fit') {
    if (baseRatio > containerRatio) {
      targetWmm = containerWmm;
      targetHmm = targetWmm / baseRatio;
    } else {
      targetHmm = containerHmm;
      targetWmm = targetHmm * baseRatio;
    }
  }

  if (p.fitMode === 'fill') {
    if (baseRatio > containerRatio) {
      targetHmm = containerHmm;
      targetWmm = targetHmm * baseRatio;
    } else {
      targetWmm = containerWmm;
      targetHmm = targetWmm / baseRatio;
    }
  }

  const scale = p.scalePercent / 100;
  targetWmm *= scale;
  targetHmm *= scale;

  return {
    widthPx: Math.max(1, targetWmm * mmToPx),
    heightPx: Math.max(1, targetHmm * mmToPx)
  };
}

function getLayoutSheetGeometry(canvas) {
  const cw = canvas.width;
  const ch = canvas.height;
  const mediaWmm = clamp(state.artwork.placement.mediaWidthMm, 50, 2000, 330);
  const mediaHmm = clamp(state.artwork.placement.mediaHeightMm, 50, 2000, 482);
  const artworkBase = getArtworkBaseMm();
  const hasLoadedArtwork = Boolean(state.artwork?.loaded);

  // Loaded artwork drives the ruler and preview mm scale; otherwise fall back to media size.
  const previewWmm = hasLoadedArtwork ? artworkBase.width : mediaWmm;
  const previewHmm = hasLoadedArtwork
    ? Math.max(1, previewWmm * (ch / Math.max(1, cw)))
    : mediaHmm;

  const mmToPx = cw / Math.max(1, previewWmm);
  const printableHmm = getPrintableHeightMm(previewHmm);
  const printablePx = printableHmm * mmToPx;

  return {
    cw,
    ch,
    previewWmm,
    previewHmm,
    printableHmm,
    printablePx,
    mmToPx
  };
}

function renderLayoutRuler() {
  const canvas = document.getElementById('layoutRulerCanvas');
  const layoutCanvas = document.getElementById('layoutCanvas');
  if (!canvas || !layoutCanvas || typeof canvas.getContext !== 'function') return;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cssWidth = Math.max(320, Math.floor(layoutCanvas.clientWidth || layoutCanvas.width || 920));
  const cssHeight = Math.max(40, Math.floor(canvas.clientHeight || 52));
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const previewWmm = state.artwork?.loaded
    ? getArtworkBaseMm().width
    : clamp(state.artwork.placement.mediaWidthMm, 50, 2000, 330);

  const startX = 0;
  const widthPx = cssWidth;
  const pxPerMm = widthPx / Math.max(1, previewWmm);

  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const axisY = cssHeight - 14;
  ctx.strokeStyle = '#4e545b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(startX, axisY);
  ctx.lineTo(startX + widthPx, axisY);
  ctx.stroke();

  const previewWin = mmToIn(previewWmm);
  const stepIn = 0.25;
  const majorStepIn = 1;
  ctx.fillStyle = '#2c3238';
  ctx.font = '11px Segoe UI';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let inches = 0; inches <= previewWin + 0.0001; inches += stepIn) {
    const mm = inToMm(inches);
    const x = startX + mm * pxPerMm;
    const isMajor = Math.abs((inches / majorStepIn) - Math.round(inches / majorStepIn)) < 1e-6;
    const tickTop = axisY - (isMajor ? 12 : 7);
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, tickTop);
    ctx.stroke();
    if (isMajor) ctx.fillText(`${Math.round(inches)}`, x, 4);
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = '#525a63';
  ctx.fillText('Width scale (in)', cssWidth - 8, 4);
}

function renderLayoutPreview() {
  const canvas = document.getElementById('layoutCanvas');
  if (!canvas || typeof canvas.getContext !== 'function') return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { cw, ch, previewWmm, printableHmm, printablePx, mmToPx } = getLayoutSheetGeometry(canvas);

  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, cw, ch);

  const hasLoadedArtwork = Boolean(state.artwork?.loaded);
  const hasArtworkPreview = Boolean(state.artwork.previewDataUrl);
  const gridSize = 20;

  // Full-grid empty/active surface (no inner placement container).
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= cw; gx += gridSize) {
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, 0);
    ctx.lineTo(gx + 0.5, ch);
    ctx.stroke();
  }
  for (let gy = 0; gy <= ch; gy += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, gy + 0.5);
    ctx.lineTo(cw, gy + 0.5);
    ctx.stroke();
  }

  if (!hasLoadedArtwork || !hasArtworkPreview) return;

  const p = state.artwork.placement;
  const art = computeArtworkBoxPx(previewWmm, printableHmm, mmToPx);

  let x = 0;
  let y = 0;
  if (p.alignX === 'center') x = (cw - art.widthPx) / 2;
  if (p.alignX === 'right') x = cw - art.widthPx;
  if (p.alignY === 'middle') y = (printablePx - art.heightPx) / 2;
  if (p.alignY === 'bottom') y = printablePx - art.heightPx;

  x += p.offsetXmm * mmToPx;
  y += p.offsetYmm * mmToPx;

  const cx = x + art.widthPx / 2;
  const cy = y + art.heightPx / 2;
  const rotation = (p.rotationDeg * Math.PI) / 180;

  if (p.fitMode === 'fill') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, printablePx);
    ctx.clip();
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.scale(p.flipHorizontal ? -1 : 1, p.flipVertical ? -1 : 1);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (layoutPreviewImageSrc !== state.artwork.previewDataUrl) {
    layoutPreviewImage = new Image();
    layoutPreviewImageSrc = state.artwork.previewDataUrl;
    layoutPreviewImage.src = state.artwork.previewDataUrl;
    layoutPreviewImage.onload = () => renderLayoutPreview();
  }

  if (layoutPreviewImage?.complete) {
    ctx.drawImage(layoutPreviewImage, -art.widthPx / 2, -art.heightPx / 2, art.widthPx, art.heightPx);
  }

  ctx.restore();
  if (p.fitMode === 'fill') ctx.restore();
}

function updatePlacementInputs() {
  const p = state.artwork.placement;
  const arrange = state.ui?.arrange || INITIAL_STATE.ui.arrange;
  const map = {
    pageSizePreset: p.pageSizePreset || 'custom',
    pageOrientation: p.orientation || 'portrait',
    mediaWidth: formatInchesForInput(p.mediaWidthMm),
    mediaHeight: formatInchesForInput(p.mediaHeightMm),
    rotationDeg: p.rotationDeg,
    offsetX: formatInchesForInput(p.offsetXmm),
    offsetY: formatInchesForInput(p.offsetYmm),
    gapHorizontal: formatInchesForInput(arrange.gapHorizontalMm),
    gapVertical: formatInchesForInput(arrange.gapVerticalMm),
    copyHorizontalCount: arrange.copyHorizontalCount,
    copyVerticalCount: arrange.copyVerticalCount,
    copyHorizontalSpacing: formatInchesForInput(arrange.copyHorizontalSpacingMm),
    copyVerticalSpacing: formatInchesForInput(arrange.copyVerticalSpacingMm)
  };

  for (const [id, val] of Object.entries(map)) {
    if (JOB_NUMERIC_EDITING_IDS.has(id)) continue;
    const el = document.getElementById(id);
    if (el && String(el.value) !== String(val)) el.value = val;
  }

  const isCustomPageSize = (p.pageSizePreset || 'custom') === 'custom';
  ['mediaWidth', 'mediaHeight'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.readOnly = !isCustomPageSize;
    if (typeof el.setAttribute === 'function') {
      el.setAttribute('aria-readonly', !isCustomPageSize ? 'true' : 'false');
    }
  });

  const copyInterval = document.getElementById('copyIntervalIncludesSize');
  if (copyInterval) copyInterval.checked = Boolean(arrange.copyIntervalIncludesSize);

}

function syncTopTabUI() {
  const active = state.ui?.topTab === 'jobs' ? 'jobs' : 'printhead';
  const tabs = {
    printhead: document.getElementById('tabPrintheadControls'),
    jobs: document.getElementById('tabJobSubmission')
  };
  const panels = {
    printhead: document.getElementById('panelPrintheadControls'),
    jobs: document.getElementById('panelJobSubmission')
  };

  Object.entries(tabs).forEach(([key, tab]) => {
    if (!tab) return;
    const selected = key === active;
    if (typeof tab.setAttribute === 'function') {
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    tab.tabIndex = selected ? 0 : -1;
  });

  Object.entries(panels).forEach(([key, panel]) => {
    if (!panel) return;
    panel.hidden = key !== active;
  });
}

function setTopTab(nextTab, { focus = false } = {}) {
  const tab = nextTab === 'jobs' ? 'jobs' : 'printhead';
  if (!state.ui) state.ui = deepClone(INITIAL_STATE.ui);
  state.ui.topTab = tab;
  syncTopTabUI();
  if (focus) {
    const focusEl = document.getElementById(tab === 'jobs' ? 'tabJobSubmission' : 'tabPrintheadControls');
    focusEl?.focus();
  }
  persistState();
}

function syncLeftSidebarTabUI() {
  // Front-screen UX: left sidebar is artwork-only for operators.
  const artworkPanel = document.getElementById('panelArtworkIntake');
  if (artworkPanel) artworkPanel.hidden = false;
  if (!state.ui) state.ui = deepClone(INITIAL_STATE.ui);
  state.ui.leftSidebarTab = 'artwork';
}

function setLeftSidebarTab() {
  // Retained as a no-op hook for future settings relocation.
  syncLeftSidebarTabUI();
  persistState();
}

function syncRightSidebarTabUI() {
  // Live status/logs is now a permanent sidebar panel.
  const panelLive = document.getElementById('panelLive');
  if (panelLive) panelLive.hidden = false;

  if (!state.ui) state.ui = deepClone(INITIAL_STATE.ui);
  state.ui.rightSidebarTab = 'live';
}

function setRightSidebarTab() {
  // Keep hook for compatibility with older state/callers.
  syncRightSidebarTabUI();
  persistState();
}

function syncJobArrangeTabUI() {
  if (!state.ui) state.ui = deepClone(INITIAL_STATE.ui);
  state.ui.jobArrangeTab = 'arrange';
  const panel = document.getElementById('panelArrange');
  if (panel) panel.hidden = false;
}

function setJobArrangeTab() {
  if (!state.ui) state.ui = deepClone(INITIAL_STATE.ui);
  state.ui.jobArrangeTab = 'arrange';
  syncJobArrangeTabUI();
  persistState();
}

function getArtworkSizeLabel() {
  const wPt = Number(state.artwork?.pageWidthPt || 0);
  const hPt = Number(state.artwork?.pageHeightPt || 0);
  if (!wPt || !hPt) return '—';
  const w = (wPt / 72).toFixed(2);
  const h = (hPt / 72).toFixed(2);
  return `${w}×${h} in`;
}

function getJobMeta(job = {}) {
  const mode = job.mode || state.artwork?.placement?.fitMode || 'none';
  const count = job.copies ?? job.count ?? job.pages ?? 1;
  const size = job.size || getArtworkSizeLabel();
  return {
    id: job.id || '—',
    name: job.name || '—',
    mode: mode || '—',
    count: count === 0 ? '0' : String(count || '—'),
    size: size || '—',
    status: job.status || '—'
  };
}

function formatLayoutSizeInches() {
  const widthMm = Number(state.artwork?.placement?.mediaWidthMm);
  const heightMm = Number(state.artwork?.placement?.mediaHeightMm);
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm <= 0 || heightMm <= 0) {
    return '—';
  }
  return `${mmToIn(widthMm).toFixed(3)} x ${mmToIn(heightMm).toFixed(3)} inch`;
}

function getJobSettingsSnapshot(selectedJob) {
  const device = String(
    state.config?.deviceName
      || state.config?.device
      || selectedJob?.deviceName
      || selectedJob?.device
      || 'DuraFlex'
  );

  return {
    device,
    layoutSize: formatLayoutSizeInches(),
    jobFile: selectedJob?.name || state.artwork?.name || '—',
    iccProfile: selectedJob?.iccProfile || state.config?.iccProfile || 'Default',
    calibration: selectedJob?.calibration || state.config?.calibration || 'Standard',
    spotColor: selectedJob?.spotColor || state.config?.spotColor || 'Disabled',
    vdp: selectedJob?.vdp || state.config?.vdp || 'Disabled',
    regMark: selectedJob?.regMark || state.config?.regMark || 'Off'
  };
}

function getCommandButtons() {
  if (typeof document?.querySelectorAll === 'function') {
    return Array.from(document.querySelectorAll('button')).filter(btn => btn?.dataset?.c);
  }

  const containers = ['controlsCleaning', 'controlsEngine', 'controlsPriming', 'controlsHead', 'controlsPrint', 'controls']
    .map(id => document.getElementById(id))
    .filter(Boolean);

  const buttons = [];
  containers.forEach(container => {
    if (typeof container?.querySelectorAll === 'function') {
      buttons.push(...Array.from(container.querySelectorAll('button')).filter(btn => btn?.dataset?.c));
    }
  });
  return buttons;
}

function hasQueuedJobs() {
  return state.jobs.some(job => job.status === 'queued');
}

function isDiscoveryReadOnlyMode() {
  return Boolean(state.config?.readOnlyDiscovery);
}

function hasActivePrintJob() {
  return state.jobs.some(job => ['sending', 'printing'].includes(String(job.status || '').toLowerCase()));
}

function isPrinterIdleForAutoDispatch() {
  const liveEngine = String(state.liveStatus?.engineState || '').toUpperCase();
  const blockingStates = ['PRINTING', 'PAUSED', 'FAULT', 'ERROR', 'NOT_READY', 'BUSY'];
  return !blockingStates.includes(liveEngine || 'UNKNOWN');
}

function getAutoSendBlockReason() {
  if (!state.controls?.autoSendEnabled) return 'Auto-send is OFF.';
  if (!hasQueuedJobs()) return 'No queued jobs.';
  if (hasActivePrintJob()) return 'Waiting for active job to finish.';
  if (!isPrinterIdleForAutoDispatch()) {
    const liveEngine = String(state.liveStatus?.engineState || 'UNKNOWN').toUpperCase();
    return `Waiting for printer READY/IDLE (current: ${liveEngine}).`;
  }
  return '';
}

function refreshQueueDepth() {
  state.status.queueDepth = state.jobs.filter(job => String(job.status || '').toLowerCase() === 'queued').length;
}

async function dispatchQueuedJob(nextJob, source = 'auto-send') {
  const bridge = getBridge();
  const hasQueuedSender = Boolean(bridge && typeof bridge.sendQueuedJob === 'function');
  const hasLegacySubmit = Boolean(bridge && typeof bridge.submitJob === 'function');
  if (!bridge || (!hasQueuedSender && !hasLegacySubmit)) {
    const msg = 'NOT-CONFIGURED: sendQueuedJob/submitJob bridge hook unavailable.';
    state.submission.lastResult = `ERROR: ${msg}`;
    nextJob.status = 'failed';
    nextJob.error = msg;
    log(msg);
    await appendAudit({ type: 'send-job', copies: Number(nextJob.copies || 1), outcome: 'bridge-unavailable', error: msg, jobId: nextJob.id });
    return false;
  }

  if (!nextJob.inputPath) {
    const msg = 'Missing local file path. Load artwork from disk in Electron and retry.';
    state.submission.lastResult = `ERROR: ${msg}`;
    nextJob.status = 'failed';
    nextJob.error = msg;
    log(`Send Job aborted: ${msg}`);
    await appendAudit({ type: 'send-job', copies: Number(nextJob.copies || 1), outcome: 'invalid-payload', error: msg, jobId: nextJob.id });
    return false;
  }

  nextJob.status = 'sending';
  state.status.engine = 'PRINTING';
  state.queue.push(`dispatch(${nextJob.id}) via ${source}`);
  log(`Auto-send dispatched ${nextJob.id}.`);
  render();
  persistState();

  try {
    const copies = Math.max(1, Math.floor(Number(nextJob.copies || 1)));
    const canSendQueued = typeof bridge.sendQueuedJob === 'function';
    const result = canSendQueued
      ? await bridge.sendQueuedJob({ bridgeJobId: nextJob.bridgeJobId || nextJob.id, copies })
      : await bridge.submitJob({
        jobId: nextJob.id,
        fileName: nextJob.name || state.artwork.name || null,
        inputPath: nextJob.inputPath,
        copies,
        args: copies > 1 ? ['--copies', String(copies)] : [],
        config: state.config,
        settings: {
          ...deepClone(state.artwork.placement),
          inputPath: nextJob.inputPath
        }
      });

    nextJob.bridgeJobId = result?.jobId || null;
    const resultStatus = String(result?.status || 'completed').toLowerCase();
    const completed = ['completed', 'done', 'finished', 'success'].some(token => resultStatus.includes(token));
    nextJob.status = completed ? 'done' : 'printing';
    state.submission.lastResult = `SENT: ${result?.status || 'completed'}`;
    log(
      completed
        ? `Send Job completed for ${nextJob.id} (${nextJob.copies || 1} copies).`
        : `Send Job accepted for ${nextJob.id}; awaiting finish status.`
    );
    await appendAudit({ type: 'send-job', copies: Number(nextJob.copies || 1), outcome: 'adapter-sent', jobId: result?.jobId || nextJob.id });
    state.status.engine = completed ? 'IDLE' : 'PRINTING';
    return true;
  } catch (error) {
    const msg = getActionableError(error);
    nextJob.status = 'failed';
    nextJob.error = msg;
    state.submission.lastResult = `ERROR: ${msg}`;
    log(`RIP adapter unavailable. Send Job aborted. ${msg}`);
    await appendAudit({ type: 'send-job', copies: Number(nextJob.copies || 1), outcome: 'adapter-error', error: msg, jobId: nextJob.id });
    state.status.engine = 'IDLE';
    return false;
  } finally {
    refreshQueueDepth();
    render();
    persistState();
    if (state.controls?.autoSendEnabled) {
      setTimeout(() => {
        tryAutoDispatchNextJob('auto-chain');
      }, 50);
    }
  }
}

function tryAutoDispatchNextJob(source = 'auto-send') {
  if (!state.controls?.autoSendEnabled) return false;
  if (!hasQueuedJobs() || hasActivePrintJob() || !isPrinterIdleForAutoDispatch()) return false;

  const nextJob = state.jobs.find(job => String(job.status || '').toLowerCase() === 'queued');
  if (!nextJob) return false;

  dispatchQueuedJob(nextJob, source);
  return true;
}

function resolveGlobalOnlineState() {
  // Operator rule: if status polling is running, system is considered online.
  if (state.liveStatus?.running) return true;

  const connectionStatus = String(state.status?.connection || '').toUpperCase();
  if (connectionStatus.includes('OFFLINE')) return false;
  if (connectionStatus.includes('ONLINE') || connectionStatus.includes('READY') || connectionStatus.includes('CONNECTED')) return true;

  return false;
}

function renderImportantControls() {
  const controls = state.controls || INITIAL_STATE.controls;

  const globalState = resolveGlobalOnlineState();
  const globalEl = document.getElementById('globalConnectivity');
  const globalText = document.getElementById('globalConnectivityText');
  if (globalEl) {
    if (globalEl.dataset) globalEl.dataset.online = globalState ? 'true' : 'false';
    if (typeof globalEl.setAttribute === 'function') {
      globalEl.setAttribute('aria-label', `Global connectivity status: ${globalState ? 'online' : 'offline'}`);
    }
  }
  if (globalText) globalText.textContent = globalState ? 'Online' : 'Offline';

  const toggle = document.getElementById('btnAutoSendToggle');
  const text = document.getElementById('autoSendText');
  const icon = document.getElementById('autoSendIcon');
  if (!toggle || !text || !icon) return;

  const on = Boolean(controls.autoSendEnabled);
  if (typeof toggle.setAttribute === 'function') {
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    toggle.setAttribute('aria-label', on ? 'Auto-send running' : 'Auto-send paused');
  }
  icon.textContent = on ? '▶' : '⏸';
  text.textContent = on ? 'Auto-send On' : 'Auto-send Off';
}

function render() {
  renderTick += 1;
  updateSequenceStatus();

  const selectedJobId = state.ui?.selectedJobId;
  const queueSummaryEl = document.getElementById('queueFlowSummary');
  if (queueSummaryEl) {
    const activeCount = state.jobs.filter(job => ['sending', 'printing'].includes(String(job.status || '').toLowerCase())).length;
    const queuedCount = state.jobs.filter(job => String(job.status || '').toLowerCase() === 'queued').length;
    const blockedReason = getAutoSendBlockReason();
    queueSummaryEl.textContent = state.controls?.autoSendEnabled
      ? `Auto-send ON · ${activeCount} active · ${queuedCount} queued${blockedReason ? ` · ${blockedReason}` : ''}`
      : `Auto-send OFF · ${queuedCount} queued`;
  }

  const jobTable = document.getElementById('jobTable');
  if (jobTable) {
    const rows = [];
    const totalRows = Math.max(MIN_VISIBLE_QUEUE_ROWS, state.jobs.length);

    const queuedJobIds = state.jobs
      .filter(job => String(job.status || '').toLowerCase() === 'queued')
      .map(job => job.id);
    const activeJob = state.jobs.find(job => ['sending', 'printing'].includes(String(job.status || '').toLowerCase()));
    const activeJobId = activeJob?.id || null;
    const nextUpJobId = queuedJobIds[0] || null;

    for (let i = 0; i < totalRows; i += 1) {
      const job = state.jobs[i];
      if (!job) {
        rows.push(`<tr class="is-placeholder" aria-hidden="true">
          <td class="cell-job" aria-label="Empty queue row">—</td>
          <td class="cell-position">—</td>
          <td class="cell-size">—</td>
          <td class="cell-mode">—</td>
          <td class="cell-count">—</td>
          <td class="cell-status">—</td>
        </tr>`);
        continue;
      }

      const meta = getJobMeta(job);
      const fullJob = `${meta.id} · ${meta.name}`;
      const selected = selectedJobId === job.id;
      const queuePos = queuedJobIds.indexOf(job.id);
      const queuePosLabel = queuePos >= 0 ? `#${queuePos + 1}` : '—';
      const roleBadges = [];
      if (job.id === activeJobId) roleBadges.push('<span class="job-badge is-active">Active</span>');
      if (job.id === nextUpJobId) roleBadges.push('<span class="job-badge is-next">Next Up</span>');
      const roleBadgesHtml = roleBadges.length > 0 ? `<div class="job-badges">${roleBadges.join('')}</div>` : '';
      const statusLower = String(job.status || '').toLowerCase();

      rows.push(`<tr data-job-id="${escapeHtml(job.id)}" tabindex="0" role="button" aria-label="Select job ${escapeHtml(fullJob)}" aria-selected="${selected ? 'true' : 'false'}" class="${selected ? 'is-selected' : ''}">
        <td class="cell-job" title="${escapeHtml(fullJob)}">${escapeHtml(fullJob)}${roleBadgesHtml}</td>
        <td class="cell-position" title="Queue position">${escapeHtml(queuePosLabel)}</td>
        <td class="cell-size" title="${escapeHtml(meta.size)}">${escapeHtml(meta.size)}</td>
        <td class="cell-mode" title="${escapeHtml(meta.mode)}">${escapeHtml(meta.mode)}</td>
        <td class="cell-count" title="${escapeHtml(meta.count)}">${escapeHtml(meta.count)}</td>
        <td class="cell-status"><span class="status-pill status-${escapeHtml(statusLower)}" title="${escapeHtml(meta.status)}">${escapeHtml(meta.status)}</span></td>
      </tr>`);
    }

    jobTable.innerHTML = rows.join('');
  }

  getCommandButtons().forEach(btn => {
    const checks = computeEligibility(btn.dataset.c);
    const blocked = checks.find(item => item.level === 'block');
    const warning = checks.find(item => item.level === 'warn');
    const reason = blocked ? `${blocked.message} Remediation: ${blocked.remediation}` : '';
    const isReady = !blocked && !warning;
    btn.disabled = Boolean(reason);
    btn.title = reason || warning?.message || 'Operator-triggered command';
    btn.dataset.eligibility = blocked ? 'blocked' : warning ? 'warn' : 'ready';
    btn.dataset.armed = isReady ? 'true' : 'false';
  });

  const queueEl = document.getElementById('queue');
  if (queueEl) {
    queueEl.innerHTML = state.queue.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  }

  const statusEl = document.getElementById('statusCards');
  if (statusEl) {
    statusEl.innerHTML = Object.entries(state.status)
      .map(([k, v]) => `<div class="status"><strong>${escapeHtml(k)}</strong><br/>${escapeHtml(v)}</div>`)
      .join('');
  }

  const configEl = document.getElementById('configPreview');
  if (configEl) configEl.textContent = JSON.stringify(state.config, null, 2);

  const modeBadge = document.getElementById('modeBadge');
  if (modeBadge) {
    const liveMode = state.liveStatus.source === 'bridge-http';
    const modeLabel = liveMode ? 'LIVE MODE (HTTP BRIDGE)' : 'LIVE BACKEND DOWN';
    const lock = isDiscoveryReadOnlyMode() ? ' · DISCOVERY-LOCK' : '';
    modeBadge.textContent = `${modeLabel}${lock} · ${state.config.operatorProfile} · ${state.config.host}:${state.config.commandPort}`;
  }

  const liveStatusEl = document.getElementById('liveStatusCards');
  if (liveStatusEl) {
    const last = state.liveStatus.lastUpdate ? new Date(state.liveStatus.lastUpdate).toLocaleTimeString() : '—';
    liveStatusEl.innerHTML = [
      ['engineRaw', state.liveStatus.engineStateRawLabel || state.liveStatus.engineState || 'UNKNOWN'],
      ['engineCanonical', state.liveStatus.engineState || 'UNKNOWN'],
      ['queue', String(state.liveStatus.queueLength)],
      ['faults', state.liveStatus.faults.join(', ') || 'none'],
      ['lastUpdate', last]
    ]
      .map(([k, v]) => `<div class="status"><strong>${escapeHtml(k)}</strong><br/>${escapeHtml(v)}</div>`)
      .join('');
  }

  const systemStateValueEl = document.getElementById('systemStateValue');
  if (systemStateValueEl) {
    const rawEngineState = String(state.liveStatus?.engineStateRawLabel || '').trim().toUpperCase();
    const canonicalState = String(state.liveStatus?.engineState || '').trim().toUpperCase();
    systemStateValueEl.textContent = rawEngineState || canonicalState || 'UNKNOWN';
  }

  const ink = state.liveStatus?.inkLevels || { C: 0, M: 0, Y: 0, K: 0 };
  ['C', 'M', 'Y', 'K'].forEach(channel => {
    const pct = Math.max(0, Math.min(100, Number(ink[channel]) || 0));
    const pctEl = document.getElementById(`inkPercent${channel}`);
    if (pctEl) {
      pctEl.textContent = `${pct}%`;
      pctEl.setAttribute('aria-label', `Ink ${channel} ${pct} percent`);
    }
    const barEl = document.getElementById(`inkBar${channel}`);
    if (barEl) {
      barEl.style.width = `${pct}%`;
    }
  });

  const simBadge = document.getElementById('simulationBadge');
  if (simBadge) {
    const bridgeOnline = state.liveStatus.source === 'bridge-http' && !String(state.liveStatus.engineState || '').startsWith('DOWN');
    const base = bridgeOnline ? 'LIVE BACKEND (HTTP BRIDGE)' : 'LIVE BACKEND DOWN';
    const bridgeState = getBridgeHealth().label;
    const lock = isDiscoveryReadOnlyMode() ? ' · DISCOVERY LOCK' : '';
    simBadge.textContent = `${base} · ${bridgeState}${lock}`;
  }

  const discoveryToggle = document.getElementById('btnToggleDiscoveryMode');
  if (discoveryToggle) {
    discoveryToggle.textContent = isDiscoveryReadOnlyMode()
      ? 'Discovery Lock: ON (Read-only)'
      : 'Discovery Lock: OFF (Mutating commands allowed)';
    if (typeof discoveryToggle.setAttribute === 'function') {
      discoveryToggle.setAttribute('aria-pressed', isDiscoveryReadOnlyMode() ? 'true' : 'false');
    }
  }

  const discoveryHint = document.getElementById('discoveryModeHint');
  if (discoveryHint) {
    if (isDiscoveryReadOnlyMode()) {
      discoveryHint.textContent = 'Read-only discovery mode is active. Unlock discovery mode to enable mutating commands.';
    } else if (!state.liveStatus.running) {
      discoveryHint.textContent = 'Discovery lock is off. Mutating commands are available; start polling for fresher safety telemetry.';
    } else {
      discoveryHint.textContent = 'Discovery lock is off and polling is running. Mutating commands are available unless engine fault gates are active.';
    }
  }

  const commandError = document.getElementById('commandError');
  if (commandError) commandError.textContent = state.commandError || '';

  const connPreview = document.getElementById('connectionPreview');
  if (connPreview) connPreview.textContent = JSON.stringify(state.connectionTests, null, 2);

  const pipelineEl = document.getElementById('pipelinePreview');
  if (pipelineEl) {
    pipelineEl.textContent = JSON.stringify(
      {
        expected: state.simulator.expected,
        stepIndex: state.simulator.stepIndex,
        expectedNext: state.simulator.expected[state.simulator.stepIndex] || 'complete',
        lastResult: state.simulator.lastResult,
        history: state.simulator.history.slice(0, 8),
        artwork: {
          loaded: state.artwork.loaded,
          file: state.artwork.name,
          fitMode: state.artwork.placement.fitMode,
          renderTick
        }
      },
      null,
      2
    );
  }

  const preflightEl = document.getElementById('preflightPreview');
  if (preflightEl) preflightEl.textContent = JSON.stringify(state.preflight, null, 2);

  const submissionEl = document.getElementById('submissionPreview');
  if (submissionEl) submissionEl.textContent = JSON.stringify(state.submission, null, 2);

  const retentionInput = document.getElementById('auditRetentionMax');
  if (retentionInput && String(retentionInput.value) !== String(state.audit.retentionMaxEntries)) {
    retentionInput.value = state.audit.retentionMaxEntries;
  }

  const filterInput = document.getElementById('auditFilterType');
  if (filterInput && String(filterInput.value) !== String(state.audit.filterType || 'all')) {
    filterInput.value = state.audit.filterType || 'all';
  }

  const filteredAudit = getFilteredAuditEntries();

  const auditStatsEl = document.getElementById('auditStats');
  if (auditStatsEl) {
    auditStatsEl.textContent = `Total ${state.audit.entries.length} · Showing ${Math.min(filteredAudit.length, 20)} · Retention ${state.audit.retentionMaxEntries}`;
  }

  const auditEl = document.getElementById('auditPreview');
  if (auditEl) auditEl.textContent = JSON.stringify(filteredAudit.slice(0, 20), null, 2);

  const loadedArtworkName = state.artwork.loaded ? state.artwork.name : 'None';
  const fileNameEl = document.getElementById('loadedFileName');
  if (fileNameEl) fileNameEl.textContent = loadedArtworkName;

  const w = state.artwork.pageWidthPt / 72;
  const h = state.artwork.pageHeightPt / 72;
  const pageSizeText = `${w.toFixed(2)} × ${h.toFixed(2)} in`;

  const pageSizeEl = document.getElementById('pdfPageSize');
  if (pageSizeEl) pageSizeEl.textContent = pageSizeText;

  const selectedJob = state.jobs.find(job => job.id === selectedJobId);
  const selectedLabel = selectedJob ? `${selectedJob.id} · ${selectedJob.name}` : '—';
  const placement = state.artwork?.placement || {};
  const placementText = `${placement.alignX || 'center'} / ${placement.alignY || 'middle'} · ${placement.fitMode || 'none'}`;

  const jobInfoSelected = document.getElementById('jobInfoSelected');
  if (jobInfoSelected) jobInfoSelected.textContent = selectedLabel;
  const jobInfoLoadedFile = document.getElementById('jobInfoLoadedFile');
  if (jobInfoLoadedFile) jobInfoLoadedFile.textContent = loadedArtworkName;
  const jobInfoPdfSize = document.getElementById('jobInfoPdfSize');
  if (jobInfoPdfSize) jobInfoPdfSize.textContent = pageSizeText;
  const jobInfoPlacement = document.getElementById('jobInfoPlacement');
  if (jobInfoPlacement) jobInfoPlacement.textContent = placementText;

  const jobSettings = getJobSettingsSnapshot(selectedJob);
  const jobSettingsMap = {
    jobSettingDevice: jobSettings.device,
    jobSettingLayoutSize: jobSettings.layoutSize,
    jobSettingJobFile: jobSettings.jobFile,
    jobSettingIccProfile: jobSettings.iccProfile,
    jobSettingCalibration: jobSettings.calibration,
    jobSettingSpotColor: jobSettings.spotColor,
    jobSettingVdp: jobSettings.vdp,
    jobSettingRegMark: jobSettings.regMark
  };
  Object.entries(jobSettingsMap).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '—';
  });

  const alignButtonState = [
    ['btnAlignLeft', placement.alignX === 'left'],
    ['btnAlignCenter', placement.alignX === 'center'],
    ['btnAlignRight', placement.alignX === 'right'],
    ['btnAlignTop', placement.alignY === 'top'],
    ['btnAlignMiddle', placement.alignY === 'middle'],
    ['btnAlignBottom', placement.alignY === 'bottom'],
    ['btnFlipHorizontal', Boolean(placement.flipHorizontal)],
    ['btnFlipVertical', Boolean(placement.flipVertical)]
  ];
  alignButtonState.forEach(([id, active]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    if (typeof btn.setAttribute === 'function') {
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (btn.dataset) {
      btn.dataset.armed = active ? 'true' : 'false';
    }
  });

  updatePlacementInputs();
  renderLayoutRuler();
  renderLayoutPreview();
  renderEligibility();
  renderImportantControls();
  syncTopTabUI();
  syncLeftSidebarTabUI();
  syncRightSidebarTabUI();
  syncJobArrangeTabUI();
}

function addMockJob() {
  state.counter += 1;
  const id = `JOB-${String(state.counter).padStart(4, '0')}`;
  const name = state.artwork.loaded ? `${state.artwork.name.replace(/\.pdf$/i, '')}_${state.counter}.pdf` : `mock_${state.counter}.pdf`;
  state.jobs.push({ id, name, status: 'queued' });
  refreshQueueDepth();
  state.queue.push(`submit(${id})`);
  log(`Queued deterministic mock job ${id}`);
  tryAutoDispatchNextJob('job-added');
  render();
  persistState();
}

function getRequestedCopies() {
  const input = document.getElementById('sendJobCopiesInput');
  return Math.max(1, Math.floor(clamp(input?.value, 1, 9999, 1)));
}

async function handleSendJobCopies(copyCount) {
  const copies = Math.max(1, Math.floor(Number(copyCount) || 1));

  if (!state.artwork.inputPath) {
    const msg = 'Missing local file path. Load artwork from disk in Electron and retry.';
    state.submission.lastResult = `ERROR: ${msg}`;
    log(`Send Job aborted: ${msg}`);
    await appendAudit({ type: 'send-job', copies, outcome: 'invalid-payload', error: msg });
    render();
    persistState();
    return;
  }

  const bridge = getBridge();
  if (!bridge || typeof bridge.ingestJob !== 'function') {
    const msg = 'NOT-CONFIGURED: ingestJob bridge hook unavailable.';
    state.submission.lastResult = `ERROR: ${msg}`;
    log(`Send Job aborted: ${msg}`);
    await appendAudit({ type: 'send-job', copies, outcome: 'bridge-unavailable', error: msg });
    render();
    persistState();
    return;
  }

  const localJobId = generateJobId();
  const payload = {
    jobId: localJobId,
    fileName: state.artwork.name || `job_${localJobId}.pdf`,
    inputPath: state.artwork.inputPath,
    copies,
    config: state.config,
    settings: {
      ...deepClone(state.artwork.placement),
      inputPath: state.artwork.inputPath
    }
  };

  try {
    const ingest = await bridge.ingestJob(payload);
    const bridgeJobId = ingest?.jobId || localJobId;

    state.jobs.push({
      id: localJobId,
      bridgeJobId,
      name: state.artwork.name || `job_${localJobId}.pdf`,
      status: 'queued',
      copies,
      inputPath: state.artwork.inputPath,
      createdAt: new Date().toISOString()
    });

    state.submission.lastJobId = localJobId;
    state.submission.lastResult = `QUEUED: ${localJobId} (${copies} copies)`;
    state.queue.push(`queued(${localJobId}, bridge=${bridgeJobId}, copies=${copies})`);
    refreshQueueDepth();
    log(`Queued ${localJobId} (${copies} copies) as bridge job ${bridgeJobId}.`);

    await appendAudit({ type: 'send-job', copies, outcome: 'queued', jobId: localJobId, bridgeJobId });

    if (state.controls?.autoSendEnabled) {
      tryAutoDispatchNextJob('queue-on-submit');
    }
  } catch (error) {
    const msg = getActionableError(error);
    state.submission.lastResult = `ERROR: ${msg}`;
    log(`Send Job aborted: ${msg}`);
    await appendAudit({ type: 'send-job', copies, outcome: 'ingest-error', error: msg, jobId: localJobId });
  }

  render();
  persistState();
}

function closeSendJobDialog() {
  const dialog = document.getElementById('sendJobDialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close('cancel');
  }
}

function openSendJobDialog() {
  const dialog = document.getElementById('sendJobDialog');
  const copiesInput = document.getElementById('sendJobCopiesInput');

  if (!dialog || typeof dialog.showModal !== 'function') {
    const fallback = typeof window !== 'undefined' && typeof window.prompt === 'function'
      ? window.prompt('Amount of copies', '1')
      : '1';
    if (fallback == null) return;
    const parsed = Math.max(1, Math.floor(Number(fallback) || 1));
    handleSendJobCopies(parsed);
    return;
  }

  if (copiesInput) copiesInput.value = '1';
  dialog.showModal();
  if (copiesInput && typeof copiesInput.focus === 'function') {
    setTimeout(() => {
      copiesInput.focus();
      copiesInput.select?.();
    }, 0);
  }
}

function runDiscovery() {
  state.status.discovery = 'SCANNING (READ-ONLY)';
  render();
  log('Discovery scan started (no write actions).');
  setTimeout(() => {
    state.status.discovery = `FOUND: PES@${state.config.host}:${state.config.commandPort}`;
    log(`Discovery result: commandPort=${state.config.commandPort}, eventPort=${state.config.eventPort} (simulated).`);
    render();
    persistState();
  }, 350);
}

function resetState() {
  state = deepClone(INITIAL_STATE);
  persistState();
  log('State reset to deterministic initial snapshot.');
  render();
}

function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rip-ui-prototype-state.json';
  if (typeof a.click === 'function') a.click();
  URL.revokeObjectURL(url);
  log('Exported local JSON snapshot.');
}

function getFilteredAuditEntries() {
  const filterType = state.audit?.filterType || 'all';
  if (filterType === 'all') return state.audit.entries;
  return state.audit.entries.filter(entry => entry?.type === filterType);
}

function exportAudit(format = 'ndjson') {
  const entries = getFilteredAuditEntries();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const isNdjson = format === 'ndjson';
  const content = isNdjson
    ? `${entries.map(entry => JSON.stringify(entry)).join('\n')}${entries.length ? '\n' : ''}`
    : JSON.stringify(entries, null, 2);

  const blob = new Blob([content], { type: isNdjson ? 'application/x-ndjson' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = isNdjson ? `rip-operator-audit-${timestamp}.ndjson` : `rip-operator-audit-${timestamp}.json`;
  if (typeof a.click === 'function') a.click();
  URL.revokeObjectURL(url);
  log(`Exported audit entries (${entries.length}) as ${isNdjson ? 'NDJSON' : 'JSON'}.`);
}

function setAuditRetentionFromInputs() {
  const input = document.getElementById('auditRetentionMax');
  const next = clamp(input?.value, 10, 1000, state.audit?.retentionMaxEntries || 80);
  state.audit.retentionMaxEntries = next;
  state.audit.entries = state.audit.entries.slice(0, next);
  persistState();
  render();
}

function setAuditFilterFromInputs() {
  const input = document.getElementById('auditFilterType');
  state.audit.filterType = input?.value || 'all';
  persistState();
  render();
}

function pruneAuditNow() {
  const before = state.audit.entries.length;
  const maxEntries = clamp(state.audit?.retentionMaxEntries, 10, 1000, 80);
  state.audit.retentionMaxEntries = maxEntries;
  state.audit.entries = state.audit.entries.slice(0, maxEntries);
  const dropped = Math.max(0, before - state.audit.entries.length);
  log(`Audit retention applied: kept ${state.audit.entries.length}, dropped ${dropped}.`);
  persistState();
  render();
}

function markJobsPrintingIfNeeded(control) {
  if (control === 'start') {
    state.jobs = state.jobs.map(j => (j.status === 'queued' ? { ...j, status: 'printing' } : j));
    state.status.engine = 'PRINTING';
    return;
  }

  if (control === 'finish') {
    state.jobs = state.jobs.map(j => (j.status === 'printing' ? { ...j, status: 'done' } : j));
    state.status.engine = 'IDLE';
    return;
  }

  if (control === 'clear') {
    state.jobs = state.jobs.map(j => ({ ...j, status: 'queued' }));
    state.status.engine = 'IDLE';
  }
}

function validateControl(control) {
  const expected = state.simulator.expected[state.simulator.stepIndex];

  if (control === 'prepare' && state.jobs.every(j => j.status !== 'queued')) {
    const message = 'FAIL: prepare requires at least one queued job';
    state.simulator.lastResult = message;
    state.simulator.history.unshift({ control, result: message });
    log(`Sequence validation failed: ${message}`);
    return false;
  }

  if (control !== expected) {
    const message = `FAIL: expected ${expected || 'complete'}, got ${control}`;
    state.simulator.lastResult = message;
    state.simulator.history.unshift({ control, result: message });
    log(`Sequence validation failed: ${message}`);
    return false;
  }

  state.simulator.stepIndex += 1;
  const done = state.simulator.stepIndex >= state.simulator.expected.length;
  const message = done
    ? 'PASS: clear/init/prepare/start/finish/shutdown sequence complete'
    : `PASS: accepted ${control}, next=${state.simulator.expected[state.simulator.stepIndex]}`;

  state.simulator.lastResult = message;
  state.simulator.history.unshift({ control, result: message });
  log(`Sequence validation: ${message}`);
  return true;
}

function pressControl(control) {
  log(`Control pressed: ${control} (simulated command pipeline)`);
  const valid = validateControl(control);

  if (valid) {
    markJobsPrintingIfNeeded(control);
  }

  if (state.simulator.history.length > 30) {
    state.simulator.history = state.simulator.history.slice(0, 30);
  }

  render();
  persistState();
}

function runPipelineSimulation() {
  if (state.simulator.running) return;

  state.simulator.running = true;
  state.simulator.stepIndex = 0;
  state.simulator.lastResult = 'RUNNING';
  state.simulator.history.unshift({ control: 'auto', result: 'RUNNING deterministic simulation' });
  state.jobs = state.jobs.map(j => ({ ...j, status: 'queued' }));
  log('Started deterministic PES command pipeline simulation.');
  render();

  const sequence = [...state.simulator.expected];
  let i = 0;

  function next() {
    if (i >= sequence.length) {
      state.simulator.running = false;
      if (!state.simulator.lastResult.startsWith('FAIL')) {
        state.simulator.lastResult = 'PASS: deterministic simulation complete';
        log('Pipeline simulation finished successfully.');
      }
      render();
      persistState();
      return;
    }

    const control = sequence[i++];
    pressControl(control);
    setTimeout(next, 120);
  }

  setTimeout(next, 100);
}

function runFaultScenario() {
  if (state.simulator.running) return;

  state.simulator.running = true;
  state.simulator.stepIndex = 0;
  state.simulator.lastResult = 'RUNNING-FAULT-SCENARIO';
  state.simulator.history.unshift({ control: 'auto', result: 'RUNNING deterministic fault scenario' });
  state.jobs = state.jobs.map(j => ({ ...j, status: 'queued' }));
  log('Started deterministic fault scenario (prepare with no queued jobs).');
  render();

  const steps = ['clear', 'initialise'];
  let i = 0;

  function next() {
    if (i < steps.length) {
      pressControl(steps[i++]);
      setTimeout(next, 120);
      return;
    }

    state.jobs = state.jobs.map(j => ({ ...j, status: 'held' }));
    refreshQueueDepth();
    log('Fault injection: set all jobs to held before prepare.');
    render();
    persistState();

    pressControl('prepare');
    state.simulator.running = false;
    log('Fault scenario completed.');
    render();
    persistState();
  }

  setTimeout(next, 100);
}

function runRecoveryScenario() {
  if (state.simulator.running) return;

  state.simulator.running = true;
  state.simulator.stepIndex = 0;
  state.simulator.lastResult = 'RUNNING-RECOVERY-SCENARIO';
  state.simulator.history.unshift({ control: 'auto', result: 'RUNNING deterministic recovery scenario' });
  state.jobs = state.jobs.map(j => ({ ...j, status: 'queued' }));
  log('Started deterministic recovery scenario.');
  render();

  const setupSteps = ['clear', 'initialise'];
  let i = 0;

  function afterSetup() {
    state.jobs = state.jobs.map(j => ({ ...j, status: 'held' }));
    refreshQueueDepth();
    log('Recovery scenario fault injection: set all jobs to held before prepare.');
    render();
    persistState();

    pressControl('prepare');

    const firstHeld = state.jobs.find(j => j.status === 'held');
    if (firstHeld) {
      firstHeld.status = 'queued';
      log(`Recovery action: re-queued ${firstHeld.id}.`);
    }

    state.simulator.stepIndex = 2;
    pressControl('prepare');
    pressControl('start');
    pressControl('finish');

    state.simulator.lastResult = 'PASS-RECOVERY: fault recovered and print lifecycle completed';
    state.simulator.history.unshift({ control: 'recovery', result: state.simulator.lastResult });
    state.simulator.running = false;
    log('Recovery scenario completed with deterministic PASS.');
    render();
    persistState();
  }

  function next() {
    if (i < setupSteps.length) {
      pressControl(setupSteps[i++]);
      setTimeout(next, 120);
      return;
    }

    afterSetup();
  }

  setTimeout(next, 100);
}

function resetPlacementForLoadedArtwork() {
  const p = state.artwork.placement;
  p.alignX = 'center';
  p.alignY = 'middle';
  p.offsetXmm = 0;
  p.offsetYmm = 0;
  p.scalePercent = 100;
  p.fitMode = 'fit';
}

function applyPageSizeControlsFromInputs() {
  const p = state.artwork.placement;
  const selectedPreset = document.getElementById('pageSizePreset')?.value || p.pageSizePreset || 'custom';
  const selectedOrientation = document.getElementById('pageOrientation')?.value || p.orientation || 'portrait';

  p.pageSizePreset = selectedPreset;
  p.orientation = selectedOrientation === 'landscape' ? 'landscape' : 'portrait';

  if (p.pageSizePreset !== 'custom') {
    const dims = getPresetDimensionsForOrientation(p.pageSizePreset, p.orientation);
    if (dims) {
      p.mediaWidthMm = dims.widthMm;
      p.mediaHeightMm = dims.heightMm;
    }
  }

  render();
  persistState();
}

function applyPlacementFromInputs() {
  const p = state.artwork.placement;
  const mediaMinIn = mmToIn(50);
  const mediaMaxIn = mmToIn(2000);
  const offsetMinIn = mmToIn(-1000);
  const offsetMaxIn = mmToIn(1000);

  if ((p.pageSizePreset || 'custom') === 'custom') {
    p.mediaWidthMm = inToMm(clamp(document.getElementById('mediaWidth')?.value, mediaMinIn, mediaMaxIn, mmToIn(p.mediaWidthMm)));
    p.mediaHeightMm = inToMm(clamp(document.getElementById('mediaHeight')?.value, mediaMinIn, mediaMaxIn, mmToIn(p.mediaHeightMm)));
    p.orientation = p.mediaWidthMm > p.mediaHeightMm ? 'landscape' : 'portrait';
  } else {
    const dims = getPresetDimensionsForOrientation(p.pageSizePreset, p.orientation || 'portrait');
    if (dims) {
      p.mediaWidthMm = dims.widthMm;
      p.mediaHeightMm = dims.heightMm;
    }
  }

  p.rotationDeg = clamp(document.getElementById('rotationDeg')?.value, -180, 180, p.rotationDeg);
  p.offsetXmm = inToMm(clamp(document.getElementById('offsetX')?.value, offsetMinIn, offsetMaxIn, mmToIn(p.offsetXmm)));
  p.offsetYmm = inToMm(clamp(document.getElementById('offsetY')?.value, offsetMinIn, offsetMaxIn, mmToIn(p.offsetYmm)));

  render();
  persistState();
}

async function renderPdfFirstPage(arrayBuffer, fileName) {
  const hasPdfJs = typeof window !== 'undefined' && window.pdfjsLib;

  if (!hasPdfJs) {
    state.artwork.loaded = true;
    state.artwork.name = fileName;
    resetPlacementForLoadedArtwork();
    log('PDF selected (preview rendering unavailable in this environment).');
    render();
    persistState();
    return;
  }

  try {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });

    state.artwork.loaded = true;
    state.artwork.name = fileName;
    state.artwork.pageWidthPt = viewport.width;
    state.artwork.pageHeightPt = viewport.height;
    resetPlacementForLoadedArtwork();

    // High-resolution source for sheet layout preview.
    const hiResTargetWidthPx = 1800;
    const hiResScale = hiResTargetWidthPx / viewport.width;
    const hiResViewport = page.getViewport({ scale: hiResScale });
    const hiResCanvas = document.createElement('canvas');
    hiResCanvas.width = Math.ceil(hiResViewport.width);
    hiResCanvas.height = Math.ceil(hiResViewport.height);
    const hiResCtx = hiResCanvas.getContext('2d');

    if (!hiResCtx) {
      log('PDF selected (preview rendering unavailable in this environment).');
      render();
      persistState();
      return;
    }

    hiResCtx.imageSmoothingEnabled = true;
    hiResCtx.imageSmoothingQuality = 'high';
    await page.render({ canvasContext: hiResCtx, viewport: hiResViewport }).promise;
    state.artwork.previewDataUrl = hiResCanvas.toDataURL('image/png');

    log(`Loaded artwork preview: ${fileName}`);
    render();
    persistState();
  } catch (error) {
    log(`PDF load failed (deterministic safe fallback): ${error.message}`);
  }
}

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = event => {
    const img = new Image();
    img.onload = () => {
      state.artwork.loaded = true;
      state.artwork.name = file.name;
      // Image metadata usually lacks physical units; treat source pixels as 72pt-equivalent.
      state.artwork.pageWidthPt = Math.max(1, img.naturalWidth || 1);
      state.artwork.pageHeightPt = Math.max(1, img.naturalHeight || 1);
      state.artwork.previewDataUrl = event.target.result;
      resetPlacementForLoadedArtwork();
      log(`Loaded image preview: ${file.name}`);
      render();
      persistState();
    };
    img.onerror = () => log('Image decode failed for selected file.');
    img.src = event.target.result;
  };
  reader.onerror = () => log('File read failed for selected image.');
  reader.readAsDataURL(file);
}

function handleArtworkFile(file) {
  if (!file) return;
  state.artwork.inputPath = typeof file.path === 'string' ? file.path : '';
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const reader = new FileReader();
    reader.onload = async event => {
      const arrayBuffer = event.target.result;
      await renderPdfFirstPage(arrayBuffer, file.name);
    };
    reader.onerror = () => log('File read failed for selected PDF.');
    reader.readAsArrayBuffer(file);
    return;
  }

  if (/^image\//i.test(file.type)) {
    handleImageFile(file);
    return;
  }

  log('Ignored unsupported file type. Use PDF or image.');
}

let modeling3dView = 'home';
let modeling3dDraftLabel = null;
let modeling3dViewerRuntime = null;
let modeling3dDisplayedDesignId = '';

function generateDesignId() {
  return `dsn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadDesignRecords() {
  const parsed = readJsonFromStorage(DESIGNS_STORAGE_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const objectTemplateId = getObjectTemplateIdFromRecord(item);
      const labelTransform = normalizeDesignLabelTransform(item.labelTransform);
      const materialPreset = normalizeDesignMaterialPreset(item.materialPreset);
      return {
        ...item,
        objectTemplateId,
        objectType: objectTemplateId,
        materialPreset,
        labelTransform,
        facePlacement: normalizeDesignFacePlacement(item.facePlacement, objectTemplateId, labelTransform)
      };
    });
}

function saveDesignRecords(records) {
  return writeJsonToStorage(DESIGNS_STORAGE_KEY, Array.isArray(records) ? records : []);
}

function getCurrentJobLabelSource() {
  if (!state.artwork?.previewDataUrl) return null;
  return {
    dataUrl: state.artwork.previewDataUrl,
    name: state.artwork.name || 'current-job-label',
    mimeType: /^data:([^;,]+)/i.exec(state.artwork.previewDataUrl)?.[1] || 'image/png',
    source: 'current-job'
  };
}

const DESIGN_LABEL_TRANSFORM_DEFAULTS = Object.freeze({
  scalePercent: 100,
  offsetX: 0,
  offsetY: 0,
  rotationDeg: 0
});

const DESIGN_FACE_FIT_MODE_DEFAULT = 'contain';
const DESIGN_FACE_FIT_MODES = Object.freeze(['contain', 'cover', 'stretch']);

const DESIGN_MATERIAL_PRESET_DEFAULT = 'matte';
const DESIGN_MATERIAL_PRESETS = Object.freeze(['matte', 'gloss', 'kraft']);

const DESIGN_FACE_PLACEMENT_DEFAULTS = Object.freeze({
  selectedFaceId: 1,
  faces: {}
});

const DESIGN_LABEL_TRANSFORM_LIMITS = Object.freeze({
  scalePercent: { min: 10, max: 250, step: 1 },
  offsetX: { min: -0.6, max: 0.6, step: 0.01 },
  offsetY: { min: -0.6, max: 0.6, step: 0.01 },
  rotationDeg: { min: -180, max: 180, step: 1 }
});

function normalizeDesignLabelTransform(value) {
  const transform = value && typeof value === 'object' ? value : {};
  return {
    scalePercent: clamp(
      transform.scalePercent,
      DESIGN_LABEL_TRANSFORM_LIMITS.scalePercent.min,
      DESIGN_LABEL_TRANSFORM_LIMITS.scalePercent.max,
      DESIGN_LABEL_TRANSFORM_DEFAULTS.scalePercent
    ),
    offsetX: clamp(
      transform.offsetX,
      DESIGN_LABEL_TRANSFORM_LIMITS.offsetX.min,
      DESIGN_LABEL_TRANSFORM_LIMITS.offsetX.max,
      DESIGN_LABEL_TRANSFORM_DEFAULTS.offsetX
    ),
    offsetY: clamp(
      transform.offsetY,
      DESIGN_LABEL_TRANSFORM_LIMITS.offsetY.min,
      DESIGN_LABEL_TRANSFORM_LIMITS.offsetY.max,
      DESIGN_LABEL_TRANSFORM_DEFAULTS.offsetY
    ),
    rotationDeg: clamp(
      transform.rotationDeg,
      DESIGN_LABEL_TRANSFORM_LIMITS.rotationDeg.min,
      DESIGN_LABEL_TRANSFORM_LIMITS.rotationDeg.max,
      DESIGN_LABEL_TRANSFORM_DEFAULTS.rotationDeg
    )
  };
}

function normalizeDesignFaceFitMode(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return DESIGN_FACE_FIT_MODES.includes(candidate) ? candidate : DESIGN_FACE_FIT_MODE_DEFAULT;
}

function normalizeDesignMaterialPreset(value) {
  const candidate = String(value || '').trim().toLowerCase();
  return DESIGN_MATERIAL_PRESETS.includes(candidate) ? candidate : DESIGN_MATERIAL_PRESET_DEFAULT;
}

function normalizeDesignFacePlacementEntry(value, legacyTransform = null) {
  const raw = value && typeof value === 'object' ? value : {};
  const hasNestedTransform = raw.transform && typeof raw.transform === 'object';
  const transform = normalizeDesignLabelTransform(hasNestedTransform ? raw.transform : (legacyTransform || raw));
  return {
    fitMode: normalizeDesignFaceFitMode(raw.fitMode),
    transform
  };
}

function normalizeDesignFacePlacement(value, templateId, legacyLabelTransform) {
  const faceMap = getFaceMapForTemplate(templateId);
  const placement = value && typeof value === 'object' ? value : {};
  const rawFaces = placement.faces && typeof placement.faces === 'object' ? placement.faces : {};
  const faces = {};
  const legacyTransform = normalizeDesignLabelTransform(legacyLabelTransform);

  faceMap.forEach(face => {
    const raw = rawFaces[String(face.id)];
    if (raw) {
      faces[String(face.id)] = normalizeDesignFacePlacementEntry(raw);
      return;
    }
    if (face.id === 1) {
      faces[String(face.id)] = normalizeDesignFacePlacementEntry({ transform: legacyTransform, fitMode: DESIGN_FACE_FIT_MODE_DEFAULT });
      return;
    }
    faces[String(face.id)] = normalizeDesignFacePlacementEntry({ transform: DESIGN_LABEL_TRANSFORM_DEFAULTS, fitMode: DESIGN_FACE_FIT_MODE_DEFAULT });
  });

  const selectedFaceId = normalizeFaceId(placement.selectedFaceId ?? DESIGN_FACE_PLACEMENT_DEFAULTS.selectedFaceId, templateId);
  return { selectedFaceId, faces };
}

function destroy3dViewerRuntime() {
  if (!modeling3dViewerRuntime) return;
  if (typeof modeling3dViewerRuntime.stop === 'function') {
    modeling3dViewerRuntime.stop();
  }
  modeling3dViewerRuntime = null;
}

function getObjectTemplateById(templateId) {
  const normalized = String(templateId || '').trim().toLowerCase();
  return OBJECT_TEMPLATE_REGISTRY.find(template => template.id === normalized) || null;
}

function getFaceMapForTemplate(templateId) {
  const normalized = String(templateId || '').trim().toLowerCase();
  return FACE_MAP_BY_TEMPLATE[normalized] || [];
}

function normalizeFaceId(faceId, templateId) {
  const faceMap = getFaceMapForTemplate(templateId);
  if (!faceMap.length) return 1;
  const numeric = Number(faceId);
  if (Number.isFinite(numeric) && faceMap.some(face => face.id === numeric)) return numeric;
  return faceMap[0].id;
}

function getObjectTemplateIdFromRecord(record) {
  const fromTemplateField = getObjectTemplateById(record?.objectTemplateId);
  if (fromTemplateField) return fromTemplateField.id;

  const fromObjectType = getObjectTemplateById(record?.objectType);
  if (fromObjectType) return fromObjectType.id;

  return DEFAULT_OBJECT_TEMPLATE_ID;
}

function getObjectTemplateLabelForRecord(record) {
  const template = getObjectTemplateById(record?.objectTemplateId) || getObjectTemplateById(record?.objectType);
  if (template) return template.label;
  return String(record?.objectType || record?.objectTemplateId || 'Container');
}

function save3dDesignFacePlacement(designId, facePlacement) {
  if (!designId) return false;
  const records = loadDesignRecords();
  const index = records.findIndex(record => record.id === designId);
  if (index < 0) return false;
  const objectTemplateId = getObjectTemplateIdFromRecord(records[index]);
  const normalizedFacePlacement = normalizeDesignFacePlacement(
    facePlacement,
    objectTemplateId,
    records[index].labelTransform
  );
  records[index] = {
    ...records[index],
    objectTemplateId,
    objectType: objectTemplateId,
    materialPreset: normalizeDesignMaterialPreset(records[index].materialPreset),
    facePlacement: normalizedFacePlacement,
    labelTransform: normalizedFacePlacement.faces['1']?.transform || normalizeDesignLabelTransform(records[index].labelTransform),
    updatedAt: new Date().toISOString()
  };
  return saveDesignRecords(records);
}

function save3dDesignMaterialPreset(designId, materialPreset) {
  if (!designId) return false;
  const records = loadDesignRecords();
  const index = records.findIndex(record => record.id === designId);
  if (index < 0) return false;
  records[index] = {
    ...records[index],
    materialPreset: normalizeDesignMaterialPreset(materialPreset),
    updatedAt: new Date().toISOString()
  };
  return saveDesignRecords(records);
}

function render3dModelingView(view = 'home', payload = null) {
  modeling3dView = view;
  const body = document.getElementById('modeling3dBody');
  if (!body) return;

  destroy3dViewerRuntime();
  if (view !== 'display') modeling3dDisplayedDesignId = '';

  if (view === 'new') {
    const hasCurrentJobLabel = Boolean(getCurrentJobLabelSource());
    const selectedLabelText = modeling3dDraftLabel
      ? `Selected: ${escapeHtml(modeling3dDraftLabel.name || 'label image')}`
      : 'No label selected yet.';
    const objectOptions = OBJECT_TEMPLATE_REGISTRY
      .map(template => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.label)}</option>`)
      .join('');
    body.innerHTML = `
      <section id="form3dNewDesign" class="modeling-3d-panel modeling-3d-new-design-form" autocomplete="off" aria-label="Create 3D design">
        <div class="modeling-3d-form-grid">
          <div class="modeling-3d-form-col modeling-3d-form-col-left">
            <div class="modeling-3d-field">
              <label for="input3dDesignName">Name *</label>
              <input id="input3dDesignName" type="text" maxlength="120" required placeholder="Design name" />
            </div>

            <div class="modeling-3d-field">
              <label for="input3dObjectType">Object *</label>
              <select id="input3dObjectType" required>${objectOptions}</select>
            </div>

            <div class="modeling-3d-field">
              <label for="input3dLabelFile">Label image</label>
              <input id="input3dLabelFile" type="file" accept="image/*" />
              <div class="modeling-3d-field-help">Upload a label image or reuse the current job label.</div>
              <div class="modeling-3d-label-row">
                <button id="btn3dUseCurrentLabel" type="button" ${hasCurrentJobLabel ? '' : 'disabled'}>Use current job label</button>
                <span id="text3dSelectedLabel" aria-live="polite">${selectedLabelText}</span>
              </div>
            </div>
          </div>

          <div class="modeling-3d-form-col modeling-3d-form-col-right">
            <div class="modeling-3d-field modeling-3d-notes-field">
              <label for="input3dNotes">Notes / Prompt details (optional)</label>
              <textarea id="input3dNotes" rows="4" maxlength="500" placeholder="Material, finish, render hints, constraints..."></textarea>
            </div>
          </div>
        </div>

        <div class="modeling-3d-inline-actions modeling-3d-form-actions">
          <button id="btn3dSaveDesign" type="button" class="btn-primary">Save Design</button>
          <button id="btn3dCancelDesign" type="button">Back</button>
        </div>
      </section>
    `;
    return;
  }

  if (view === 'saved') {
    const records = loadDesignRecords();
    const rows = records.length
      ? records.map(record => {
        const shortId = escapeHtml(String(record.id || '').slice(0, 10));
        const thumb = record.labelImageDataUrl
          ? `<img src="${escapeHtml(record.labelImageDataUrl)}" alt="Label thumbnail" class="modeling-3d-thumb" />`
          : '<span class="modeling-3d-thumb-empty">No label</span>';
        return `
          <tr>
            <td title="${escapeHtml(record.id || '')}">${shortId}</td>
            <td>${escapeHtml(record.name || '')}</td>
            <td>${escapeHtml(getObjectTemplateLabelForRecord(record))}</td>
            <td>${thumb}</td>
            <td class="modeling-3d-actions-cell">
              <div class="modeling-3d-table-actions" role="group" aria-label="Design actions for ${escapeHtml(record.name || shortId)}">
                <button type="button" class="btn3dDisplayDesign" data-design-id="${escapeHtml(record.id || '')}">Display</button>
                <button type="button" class="btn3dDeleteDesign" data-design-id="${escapeHtml(record.id || '')}">Delete</button>
              </div>
            </td>
          </tr>
        `;
      }).join('')
      : '<tr><td colspan="5">No saved designs yet.</td></tr>';

    body.innerHTML = `
      <section class="modeling-3d-panel">
        <div class="modeling-3d-table-wrap">
          <table class="modeling-3d-table" aria-label="Saved 3D designs">
            <thead><tr><th>ID</th><th>Name</th><th>Object</th><th>Label</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="modeling-3d-inline-actions">
          <button id="btn3dSavedBack" type="button">Back</button>
        </div>
      </section>
    `;
    return;
  }

  if (view === 'display') {
    const design = payload?.design;
    const templateId = getObjectTemplateIdFromRecord(design);
    const faceMap = getFaceMapForTemplate(templateId);
    const facePlacement = normalizeDesignFacePlacement(design?.facePlacement, templateId, design?.labelTransform);
    const selectedFaceId = facePlacement.selectedFaceId;
    const selectedFaceEntry = facePlacement.faces[String(selectedFaceId)] || normalizeDesignFacePlacementEntry({ transform: design?.labelTransform });
    const transform = selectedFaceEntry.transform;
    const materialPreset = normalizeDesignMaterialPreset(design?.materialPreset);
    const faceOptions = faceMap
      .map(face => `<option value="${face.id}" ${face.id === selectedFaceId ? 'selected' : ''}>${face.id} ${escapeHtml(face.name)}</option>`)
      .join('');
    modeling3dDisplayedDesignId = String(design?.id || '');
    body.innerHTML = `
      <section class="modeling-3d-panel modeling-3d-display-panel" aria-label="3D Design Preview">
        <div class="modeling-3d-preview-header">
          <strong>${escapeHtml(design?.name || 'Design preview')}</strong>
          <span>${escapeHtml(getObjectTemplateLabelForRecord(design))}</span>
        </div>
        <div id="modeling3dViewport" class="modeling-3d-viewport" role="img" aria-label="Interactive 3D design preview">
          <div id="modeling3dHoverBadge" class="modeling-3d-hover-badge" hidden></div>
          <div id="modeling3dFaceLegend" class="modeling-3d-face-legend" aria-live="polite"></div>
        </div>
        <div id="modeling3dViewportStatus" class="modeling-3d-viewport-status" aria-live="polite"></div>

        <div class="modeling-3d-inline-actions">
          <label for="input3dMaterialPreset">Carton finish
            <select id="input3dMaterialPreset">
              <option value="matte" ${materialPreset === 'matte' ? 'selected' : ''}>Matte</option>
              <option value="gloss" ${materialPreset === 'gloss' ? 'selected' : ''}>Gloss</option>
              <option value="kraft" ${materialPreset === 'kraft' ? 'selected' : ''}>Kraft</option>
            </select>
          </label>
          <button id="btn3dResetView" type="button">Reset View</button>
        </div>

        <section class="modeling-3d-transform-panel" aria-label="Label placement controls">
          <div class="modeling-3d-face-selector-row">
            <label for="input3dFaceSelector">Face
              <select id="input3dFaceSelector">${faceOptions}</select>
            </label>
            <label for="input3dLabelFitMode">Fit mode
              <select id="input3dLabelFitMode">
                <option value="contain" ${selectedFaceEntry.fitMode === 'contain' ? 'selected' : ''}>Contain</option>
                <option value="cover" ${selectedFaceEntry.fitMode === 'cover' ? 'selected' : ''}>Cover</option>
                <option value="stretch" ${selectedFaceEntry.fitMode === 'stretch' ? 'selected' : ''}>Stretch</option>
              </select>
            </label>
          </div>
          <div class="modeling-3d-transform-grid">
            <label for="input3dLabelScale">Scale (%)
              <input id="input3dLabelScale" type="range" min="${DESIGN_LABEL_TRANSFORM_LIMITS.scalePercent.min}" max="${DESIGN_LABEL_TRANSFORM_LIMITS.scalePercent.max}" step="${DESIGN_LABEL_TRANSFORM_LIMITS.scalePercent.step}" value="${transform.scalePercent}" />
            </label>
            <label for="input3dLabelScaleNumber">Scale value
              <input id="input3dLabelScaleNumber" type="number" min="${DESIGN_LABEL_TRANSFORM_LIMITS.scalePercent.min}" max="${DESIGN_LABEL_TRANSFORM_LIMITS.scalePercent.max}" step="${DESIGN_LABEL_TRANSFORM_LIMITS.scalePercent.step}" value="${transform.scalePercent}" />
            </label>

            <label for="input3dLabelOffsetX">X offset
              <input id="input3dLabelOffsetX" type="range" min="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetX.min}" max="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetX.max}" step="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetX.step}" value="${transform.offsetX}" />
            </label>
            <label for="input3dLabelOffsetXNumber">X value
              <input id="input3dLabelOffsetXNumber" type="number" min="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetX.min}" max="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetX.max}" step="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetX.step}" value="${transform.offsetX}" />
            </label>

            <label for="input3dLabelOffsetY">Y offset
              <input id="input3dLabelOffsetY" type="range" min="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetY.min}" max="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetY.max}" step="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetY.step}" value="${transform.offsetY}" />
            </label>
            <label for="input3dLabelOffsetYNumber">Y value
              <input id="input3dLabelOffsetYNumber" type="number" min="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetY.min}" max="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetY.max}" step="${DESIGN_LABEL_TRANSFORM_LIMITS.offsetY.step}" value="${transform.offsetY}" />
            </label>

            <label for="input3dLabelRotation">Rotation (°)
              <input id="input3dLabelRotation" type="range" min="${DESIGN_LABEL_TRANSFORM_LIMITS.rotationDeg.min}" max="${DESIGN_LABEL_TRANSFORM_LIMITS.rotationDeg.max}" step="${DESIGN_LABEL_TRANSFORM_LIMITS.rotationDeg.step}" value="${transform.rotationDeg}" />
            </label>
            <label for="input3dLabelRotationNumber">Rotation value
              <input id="input3dLabelRotationNumber" type="number" min="${DESIGN_LABEL_TRANSFORM_LIMITS.rotationDeg.min}" max="${DESIGN_LABEL_TRANSFORM_LIMITS.rotationDeg.max}" step="${DESIGN_LABEL_TRANSFORM_LIMITS.rotationDeg.step}" value="${transform.rotationDeg}" />
            </label>
          </div>
          <div class="modeling-3d-inline-actions">
            <button id="btn3dLabelResetTransform" type="button">Reset / Snap to center</button>
          </div>
        </section>

        <div class="modeling-3d-inline-actions modeling-3d-form-actions">
          <button id="btn3dDisplayBack" type="button">Back to saved designs</button>
        </div>
      </section>
    `;
    if (design) {
      modeling3dViewerRuntime = start3dViewer(design);
    }
    return;
  }

  body.innerHTML = `
    <div class="modeling-3d-actions" role="group" aria-label="3D modeling actions">
      <button id="btn3dNewDesign" type="button" class="modeling-3d-action-btn">New Design</button>
      <button id="btn3dSavedDesigns" type="button" class="modeling-3d-action-btn">Saved Designs</button>
    </div>
  `;
}

function close3dModelingDialog() {
  destroy3dViewerRuntime();
  const dialog = document.getElementById('modeling3dDialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close('cancel');
  }
}

function open3dPreviewPlaceholder() {
  const dialog = document.getElementById('modeling3dDialog');
  if (!dialog || typeof dialog.showModal !== 'function') {
    log('Open 3D Preview clicked (3D Modeling shell unavailable in this runtime).');
    return;
  }

  render3dModelingView('home');
  modeling3dDraftLabel = null;
  if (!dialog.open) {
    dialog.showModal();
  }
  log('Opened 3D Modeling shell.');
}

function handle3dNewDesignClick() {
  modeling3dDraftLabel = null;
  render3dModelingView('new');
}

function handle3dSavedDesignsClick() {
  render3dModelingView('saved');
}

function display3dDesignById(designId) {
  if (!designId) return;
  const design = loadDesignRecords().find(record => record.id === designId);
  if (!design) {
    log('Selected 3D design could not be found.');
    return;
  }
  render3dModelingView('display', { design });
  log(`Displaying 3D design: ${design.name || designId.slice(0, 10)}`);
}

function start3dViewer(design) {
  const viewport = document.getElementById('modeling3dViewport');
  const status = document.getElementById('modeling3dViewportStatus');
  const THREE = window.THREE;

  const showStatus = message => {
    if (status) status.textContent = message;
  };

  if (!viewport || !THREE) {
    showStatus('3D preview unavailable: Three.js runtime is not loaded.');
    return null;
  }

  if (typeof WebGLRenderingContext === 'undefined') {
    showStatus('3D preview unavailable: WebGL is not supported in this runtime.');
    return null;
  }

  const width = Math.max(260, viewport.clientWidth || 260);
  const height = Math.max(260, viewport.clientHeight || 260);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch (_error) {
    showStatus('Unable to start 3D preview. WebGL initialization failed.');
    return null;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
  viewport.innerHTML = '';
  viewport.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const textureDisposables = [];
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  const defaultView = {
    cameraPosition: new THREE.Vector3(1.68, 1.2, 2.55),
    modelRotation: new THREE.Euler(-0.22, 0.58, 0.02),
    modelPosition: new THREE.Vector3(0, -0.03, 0)
  };
  camera.position.copy(defaultView.cameraPosition);

  if ('physicallyCorrectLights' in renderer) {
    renderer.physicallyCorrectLights = true;
  }
  if ('ACESFilmicToneMapping' in THREE) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
  }

  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 32;
  bgCanvas.height = 512;
  const bgCtx = bgCanvas.getContext('2d');
  if (bgCtx) {
    const gradient = bgCtx.createLinearGradient(0, 0, 0, bgCanvas.height);
    gradient.addColorStop(0, '#f3f5f9');
    gradient.addColorStop(0.58, '#ebeff6');
    gradient.addColorStop(1, '#d9e0ea');
    bgCtx.fillStyle = gradient;
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    const bgTexture = new THREE.CanvasTexture(bgCanvas);
    if ('SRGBColorSpace' in THREE) {
      bgTexture.colorSpace = THREE.SRGBColorSpace;
    } else if ('sRGBEncoding' in THREE) {
      bgTexture.encoding = THREE.sRGBEncoding;
    }
    scene.background = bgTexture;
    textureDisposables.push(bgTexture);
  }

  const hemiLight = new THREE.HemisphereLight(0xf0f5ff, 0xb8beca, 0.68);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.42);
  keyLight.position.set(2.8, 3.2, 2.4);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xdbe7ff, 0.7);
  fillLight.position.set(-2.2, 1.4, 1.6);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xc7dcff, 0.85);
  rimLight.position.set(-1.4, 2.1, -2.8);
  scene.add(rimLight);

  const modelGroup = new THREE.Group();
  scene.add(modelGroup);

  const textureLoader = new THREE.TextureLoader();
  let labelTexture = null;
  if ('outputColorSpace' in renderer && 'SRGBColorSpace' in THREE) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  } else if ('outputEncoding' in renderer && 'sRGBEncoding' in THREE) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }

  if (design?.labelImageDataUrl) {
    try {
      labelTexture = textureLoader.load(design.labelImageDataUrl);
      const maxAnisotropy = renderer.capabilities?.getMaxAnisotropy?.() || 1;
      labelTexture.anisotropy = Math.min(8, maxAnisotropy);
      labelTexture.minFilter = THREE.LinearMipmapLinearFilter;
      labelTexture.magFilter = THREE.LinearFilter;
      labelTexture.generateMipmaps = true;
      if ('SRGBColorSpace' in THREE) {
        labelTexture.colorSpace = THREE.SRGBColorSpace;
      } else if ('sRGBEncoding' in THREE) {
        labelTexture.encoding = THREE.sRGBEncoding;
      }
      labelTexture.needsUpdate = true;
      textureDisposables.push(labelTexture);
    } catch (_error) {
      showStatus('Label image could not be loaded. Showing neutral container.');
      labelTexture = null;
    }
  }

  const templateId = getObjectTemplateIdFromRecord(design);
  const faceMap = getFaceMapForTemplate(templateId);
  const geometryDisposables = [];
  const materialDisposables = [];

  const cartonMaterialPresets = {
    matte: [
      { color: 0xc8d0dc, roughness: 0.84, metalness: 0.01 },
      { color: 0xc8d0dc, roughness: 0.84, metalness: 0.01 },
      { color: 0xd5dce8, roughness: 0.88, metalness: 0.01 },
      { color: 0xd0d7e3, roughness: 0.82, metalness: 0.01 },
      { color: 0xd0d7e3, roughness: 0.82, metalness: 0.01 },
      { color: 0xc8d0dc, roughness: 0.86, metalness: 0.01 }
    ],
    gloss: [
      { color: 0xdfe5ee, roughness: 0.24, metalness: 0.02, clearcoat: 0.55, clearcoatRoughness: 0.18 },
      { color: 0xdfe5ee, roughness: 0.24, metalness: 0.02, clearcoat: 0.55, clearcoatRoughness: 0.18 },
      { color: 0xecf1f8, roughness: 0.28, metalness: 0.02, clearcoat: 0.52, clearcoatRoughness: 0.2 },
      { color: 0xe3e9f2, roughness: 0.22, metalness: 0.02, clearcoat: 0.58, clearcoatRoughness: 0.16 },
      { color: 0xe3e9f2, roughness: 0.22, metalness: 0.02, clearcoat: 0.58, clearcoatRoughness: 0.16 },
      { color: 0xdfe5ee, roughness: 0.25, metalness: 0.02, clearcoat: 0.5, clearcoatRoughness: 0.2 }
    ],
    kraft: [
      { color: 0xae8f67, roughness: 0.9, metalness: 0 },
      { color: 0xae8f67, roughness: 0.9, metalness: 0 },
      { color: 0xb89a72, roughness: 0.92, metalness: 0 },
      { color: 0xb29169, roughness: 0.88, metalness: 0 },
      { color: 0xb29169, roughness: 0.88, metalness: 0 },
      { color: 0xa88760, roughness: 0.93, metalness: 0 }
    ]
  };

  const boxMaterials = Array.from({ length: 6 }, () => {
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xd3d8df,
      roughness: 0.48,
      metalness: 0.05,
      emissive: 0x000000,
      emissiveIntensity: 0
    });
    materialDisposables.push(material);
    return material;
  });

  let materialPresetState = normalizeDesignMaterialPreset(design?.materialPreset);
  const applyMaterialPreset = presetValue => {
    materialPresetState = normalizeDesignMaterialPreset(presetValue);
    const configs = cartonMaterialPresets[materialPresetState] || cartonMaterialPresets[DESIGN_MATERIAL_PRESET_DEFAULT];
    boxMaterials.forEach((material, index) => {
      const config = configs[index] || configs[0];
      material.color.setHex(config.color);
      material.roughness = config.roughness;
      material.metalness = config.metalness;
      material.clearcoat = Number(config.clearcoat || 0);
      material.clearcoatRoughness = Number(config.clearcoatRoughness || 0);
      material.needsUpdate = true;
    });
  };

  const boxWidth = 1.55;
  const boxHeight = 1.05;
  const boxDepth = 0.95;

  const boxGeometry = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);
  geometryDisposables.push(boxGeometry);
  const boxMesh = new THREE.Mesh(boxGeometry, boxMaterials);
  modelGroup.add(boxMesh);

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 256;
  shadowCanvas.height = 256;
  const shadowCtx = shadowCanvas.getContext('2d');
  if (shadowCtx) {
    const shadowGradient = shadowCtx.createRadialGradient(128, 128, 20, 128, 128, 120);
    shadowGradient.addColorStop(0, 'rgba(28, 38, 52, 0.32)');
    shadowGradient.addColorStop(0.5, 'rgba(28, 38, 52, 0.16)');
    shadowGradient.addColorStop(1, 'rgba(28, 38, 52, 0)');
    shadowCtx.fillStyle = shadowGradient;
    shadowCtx.fillRect(0, 0, 256, 256);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    textureDisposables.push(shadowTexture);
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, opacity: 0.78 });
    materialDisposables.push(shadowMaterial);
    const shadowGeometry = new THREE.PlaneGeometry(boxWidth * 1.42, boxDepth * 1.42);
    geometryDisposables.push(shadowGeometry);
    const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = -(boxHeight / 2) - 0.01;
    scene.add(shadowMesh);
  }

  const labelWidth = boxWidth * 0.66;
  const labelHeight = boxHeight * 0.56;
  const labelGeometry = new THREE.PlaneGeometry(labelWidth, labelHeight);
  geometryDisposables.push(labelGeometry);

  const guideMaterial = new THREE.LineBasicMaterial({ color: 0x2f72ff, transparent: true, opacity: 0.7 });
  materialDisposables.push(guideMaterial);
  const guidePoints = [
    new THREE.Vector3(-labelWidth / 2, 0, 0),
    new THREE.Vector3(labelWidth / 2, 0, 0),
    new THREE.Vector3(0, -labelHeight / 2, 0),
    new THREE.Vector3(0, labelHeight / 2, 0)
  ];
  const guideGeometry = new THREE.BufferGeometry().setFromPoints(guidePoints);
  geometryDisposables.push(guideGeometry);

  const faceCenterById = {
    1: [0, 0, (boxDepth / 2) + 0.003],
    2: [0, 0, -(boxDepth / 2) - 0.003],
    3: [-(boxWidth / 2) - 0.003, 0, 0],
    4: [(boxWidth / 2) + 0.003, 0, 0],
    5: [0, (boxHeight / 2) + 0.003, 0],
    6: [0, -(boxHeight / 2) - 0.003, 0]
  };

  const labelMeshesByFaceId = {};
  const guideMeshesByFaceId = {};
  const baseQuaternionByFaceId = {};
  faceMap.forEach(face => {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: labelTexture || null,
      roughness: 0.7,
      metalness: 0.02,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide
    });
    materialDisposables.push(material);

    const labelMesh = new THREE.Mesh(labelGeometry, material);
    const guideMesh = new THREE.LineSegments(guideGeometry, guideMaterial);

    const normal = new THREE.Vector3(...face.normal).normalize();
    const center = new THREE.Vector3(...(faceCenterById[face.id] || [0, 0, 0]));
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    labelMesh.position.copy(center);
    labelMesh.quaternion.copy(quaternion);
    guideMesh.position.copy(center);
    guideMesh.quaternion.copy(quaternion);

    baseQuaternionByFaceId[face.id] = quaternion.clone();
    labelMeshesByFaceId[face.id] = labelMesh;
    guideMeshesByFaceId[face.id] = guideMesh;
    modelGroup.add(labelMesh);
    modelGroup.add(guideMesh);
  });

  let facePlacementState = normalizeDesignFacePlacement(design?.facePlacement, templateId, design?.labelTransform);

  const hoverBadge = document.getElementById('modeling3dHoverBadge');
  const faceLegend = document.getElementById('modeling3dFaceLegend');

  const textureAspect = (() => {
    const img = labelTexture?.image;
    const width = Number(img?.naturalWidth || img?.videoWidth || img?.width || 0);
    const height = Number(img?.naturalHeight || img?.videoHeight || img?.height || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
    return width / height;
  })();
  const labelAspect = labelWidth / labelHeight;

  const getFitScale = fitMode => {
    const mode = normalizeDesignFaceFitMode(fitMode);
    if (mode === 'stretch') return { x: 1, y: 1 };
    if (mode === 'cover') {
      return textureAspect > labelAspect
        ? { x: textureAspect / labelAspect, y: 1 }
        : { x: 1, y: labelAspect / textureAspect };
    }
    return textureAspect > labelAspect
      ? { x: 1, y: labelAspect / textureAspect }
      : { x: textureAspect / labelAspect, y: 1 };
  };

  const getSelectedFaceEntry = () => {
    const selectedFaceId = normalizeFaceId(facePlacementState.selectedFaceId, templateId);
    return facePlacementState.faces[String(selectedFaceId)] || normalizeDesignFacePlacementEntry({ transform: DESIGN_LABEL_TRANSFORM_DEFAULTS, fitMode: DESIGN_FACE_FIT_MODE_DEFAULT });
  };

  const renderFaceLegend = hoveredFaceId => {
    if (!faceLegend) return;
    faceLegend.innerHTML = faceMap.map(face => {
      const isSelected = face.id === facePlacementState.selectedFaceId;
      const isHovered = face.id === hoveredFaceId;
      return `<button type="button" class="${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}" data-face-id="${face.id}">${face.id}. ${escapeHtml(face.name)}</button>`;
    }).join('');
  };

  const applyLabelTransform = transform => {
    const selectedFaceId = normalizeFaceId(facePlacementState.selectedFaceId, templateId);
    const normalized = normalizeDesignLabelTransform(transform);
    const currentEntry = getSelectedFaceEntry();
    facePlacementState = {
      ...facePlacementState,
      selectedFaceId,
      faces: {
        ...facePlacementState.faces,
        [String(selectedFaceId)]: {
          fitMode: normalizeDesignFaceFitMode(currentEntry.fitMode),
          transform: normalized
        }
      }
    };

    faceMap.forEach(face => {
      const labelMesh = labelMeshesByFaceId[face.id];
      if (!labelMesh) return;
      const faceEntry = facePlacementState.faces[String(face.id)] || normalizeDesignFacePlacementEntry({ transform: DESIGN_LABEL_TRANSFORM_DEFAULTS });
      const transformForFace = faceEntry.transform;
      const scale = transformForFace.scalePercent / 100;
      const fitScale = getFitScale(faceEntry.fitMode);
      const uAxis = new THREE.Vector3(...face.uAxis).normalize();
      const vAxis = new THREE.Vector3(...face.vAxis).normalize();
      const offset = uAxis.multiplyScalar(transformForFace.offsetX * labelWidth)
        .add(vAxis.multiplyScalar(transformForFace.offsetY * labelHeight));
      const baseCenter = new THREE.Vector3(...(faceCenterById[face.id] || [0, 0, 0]));
      labelMesh.position.copy(baseCenter.add(offset));
      labelMesh.scale.set(scale * fitScale.x, scale * fitScale.y, 1);
      const localRotation = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        (transformForFace.rotationDeg * Math.PI) / 180
      );
      labelMesh.quaternion.copy(baseQuaternionByFaceId[face.id].clone().multiply(localRotation));
    });
  };

  const applyFaceFitMode = fitMode => {
    const selectedFaceId = normalizeFaceId(facePlacementState.selectedFaceId, templateId);
    const currentEntry = getSelectedFaceEntry();
    facePlacementState = {
      ...facePlacementState,
      selectedFaceId,
      faces: {
        ...facePlacementState.faces,
        [String(selectedFaceId)]: {
          ...currentEntry,
          fitMode: normalizeDesignFaceFitMode(fitMode)
        }
      }
    };
    applyLabelTransform(facePlacementState.faces[String(selectedFaceId)]?.transform || DESIGN_LABEL_TRANSFORM_DEFAULTS);
  };

  const setSelectedFace = (faceId, options = {}) => {
    const normalizedFaceId = normalizeFaceId(faceId, templateId);
    facePlacementState = {
      ...facePlacementState,
      selectedFaceId: normalizedFaceId
    };

    faceMap.forEach(face => {
      const isSelected = face.id === normalizedFaceId;
      const material = boxMaterials[face.materialIndex];
      if (material) {
        material.emissive.setHex(isSelected ? 0x1040b5 : 0x000000);
        material.emissiveIntensity = isSelected ? 0.58 : 0;
      }
      const guide = guideMeshesByFaceId[face.id];
      if (guide) guide.visible = isSelected;
    });

    if (!options.skipUiSync) {
      const faceSelector = document.getElementById('input3dFaceSelector');
      if (faceSelector) faceSelector.value = String(normalizedFaceId);
      const selectedEntry = facePlacementState.faces[String(normalizedFaceId)] || normalizeDesignFacePlacementEntry({ transform: DESIGN_LABEL_TRANSFORM_DEFAULTS });
      sync3dLabelTransformInputs(selectedEntry.transform);
      const fitModeInput = document.getElementById('input3dLabelFitMode');
      if (fitModeInput) fitModeInput.value = selectedEntry.fitMode;
    }

    renderFaceLegend(options.hoveredFaceId);

    if (!options.skipPersist && modeling3dDisplayedDesignId) {
      const didSave = save3dDesignFacePlacement(modeling3dDisplayedDesignId, facePlacementState);
      if (!didSave) log('Unable to persist selected face for this design.');
    }
  };

  applyLabelTransform(getSelectedFaceEntry().transform);
  setSelectedFace(facePlacementState.selectedFaceId, { skipUiSync: true, skipPersist: true });
  renderFaceLegend(null);

  if (templateId !== 'box') {
    showStatus('Object template not recognized. Showing Box fallback.');
  }

  const resetView = () => {
    camera.position.copy(defaultView.cameraPosition);
    modelGroup.position.copy(defaultView.modelPosition);
    modelGroup.rotation.set(defaultView.modelRotation.x, defaultView.modelRotation.y, defaultView.modelRotation.z);
  };

  resetView();
  applyMaterialPreset(materialPresetState);

  let rafId = 0;
  let dragging = false;
  let dragMode = 'rotate';
  let activePointerId = null;
  let lastX = 0;
  let lastY = 0;
  let pointerStartX = 0;
  let pointerStartY = 0;
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  const pickFaceFromEvent = event => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(boxMesh, false);
    const materialIndex = hits[0]?.face?.materialIndex;
    if (!Number.isFinite(materialIndex)) return null;
    const face = faceMap.find(item => item.materialIndex === materialIndex);
    return face?.id || null;
  };

  let hoveredFaceId = null;

  const setHoveredFace = (faceId, event = null) => {
    hoveredFaceId = Number.isFinite(faceId) ? faceId : null;
    renderFaceLegend(hoveredFaceId);

    if (!hoverBadge) return;
    if (!hoveredFaceId) {
      hoverBadge.hidden = true;
      return;
    }

    const face = faceMap.find(item => item.id === hoveredFaceId);
    hoverBadge.textContent = `${hoveredFaceId}. ${face?.name || 'Face'}`;
    hoverBadge.hidden = false;

    if (event) {
      const rect = renderer.domElement.getBoundingClientRect();
      const left = clamp(event.clientX - rect.left + 12, 6, rect.width - 96, 6);
      const top = clamp(event.clientY - rect.top + 12, 6, rect.height - 30, 6);
      hoverBadge.style.left = `${left}px`;
      hoverBadge.style.top = `${top}px`;
    }
  };

  const onPointerDown = event => {
    dragging = true;
    activePointerId = event.pointerId;
    dragMode = (event.button === 2 || event.shiftKey) ? 'pan' : 'rotate';
    lastX = event.clientX;
    lastY = event.clientY;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    if (typeof renderer.domElement.setPointerCapture === 'function') {
      renderer.domElement.setPointerCapture(event.pointerId);
    }
  };

  const onPointerUp = event => {
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    const moved = Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 4;
    dragging = false;
    activePointerId = null;

    if (!moved && dragMode === 'rotate' && event.button === 0 && !event.shiftKey) {
      const pickedFace = pickFaceFromEvent(event);
      if (pickedFace) {
        setSelectedFace(pickedFace);
        showStatus(`Selected face: ${pickedFace} ${faceMap.find(face => face.id === pickedFace)?.name || ''}. Drag to rotate, Shift+drag to pan, scroll to zoom.`);
      }
    }

    if (typeof renderer.domElement.releasePointerCapture === 'function') {
      try {
        renderer.domElement.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // Ignore stale pointer capture errors.
      }
    }
  };

  const onPointerMove = event => {
    if (!dragging) {
      setHoveredFace(pickFaceFromEvent(event), event);
      return;
    }
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    const deltaX = event.clientX - lastX;
    const deltaY = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    if (dragMode === 'pan') {
      modelGroup.position.x += deltaX * 0.0028;
      modelGroup.position.y -= deltaY * 0.0028;
      modelGroup.position.x = clamp(modelGroup.position.x, -1.2, 1.2, modelGroup.position.x);
      modelGroup.position.y = clamp(modelGroup.position.y, -0.9, 0.9, modelGroup.position.y);
      return;
    }

    modelGroup.rotation.y += deltaX * 0.012;
    modelGroup.rotation.x += deltaY * 0.0065;
    modelGroup.rotation.x = clamp(modelGroup.rotation.x, -0.9, 0.9, modelGroup.rotation.x);
  };

  const onWheel = event => {
    event.preventDefault();
    camera.position.z += event.deltaY * 0.0025;
    camera.position.z = clamp(camera.position.z, 1.35, 4.1, camera.position.z);
  };

  const onContextMenu = event => {
    event.preventDefault();
  };

  const onPointerLeave = () => {
    if (!dragging) setHoveredFace(null);
  };

  const onResize = () => {
    const nextWidth = Math.max(260, viewport.clientWidth || 260);
    const nextHeight = Math.max(260, viewport.clientHeight || 260);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight, false);
  };

  const animate = () => {
    rafId = window.requestAnimationFrame(animate);
    if (!dragging) {
      modelGroup.rotation.y += 0.0022;
    }
    renderer.render(scene, camera);
  };

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', onPointerLeave);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
  renderer.domElement.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('resize', onResize);

  if (faceLegend) {
    faceLegend.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-face-id]');
      if (!button) return;
      const nextFaceId = Number(button.getAttribute('data-face-id'));
      if (!Number.isFinite(nextFaceId)) return;
      setSelectedFace(nextFaceId);
    });
  }

  showStatus('Tip: hover faces for labels, click to select, or use legend/dropdown. Drag to rotate. Shift+drag (or right-drag) to pan. Scroll to zoom. Use Reset View any time.');
  animate();

  return {
    applyLabelTransform,
    applyFaceFitMode,
    applyMaterialPreset,
    resetView,
    setSelectedFace,
    getMaterialPreset() {
      return materialPresetState;
    },
    getFacePlacementState() {
      return {
        selectedFaceId: facePlacementState.selectedFaceId,
        faces: { ...facePlacementState.faces }
      };
    },
    stop() {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      materialDisposables.forEach(material => material.dispose());
      textureDisposables.forEach(texture => texture.dispose());
      geometryDisposables.forEach(geometry => geometry.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === viewport) {
        viewport.removeChild(renderer.domElement);
      }
    }
  };
}

function handle3dLabelFileChange(file) {
  if (!file) return;
  if (!/^image\//i.test(file.type)) {
    log('3D design label must be an image file.');
    return;
  }
  if (file.size > MAX_DESIGN_LABEL_FILE_BYTES) {
    log('3D design label too large. Please choose an image under 2MB.');
    return;
  }

  const reader = new FileReader();
  reader.onload = event => {
    const dataUrl = String(event?.target?.result || '');
    if (!dataUrl.startsWith('data:image/')) {
      log('3D design label read failed (invalid data URL).');
      return;
    }
    modeling3dDraftLabel = {
      dataUrl,
      name: file.name,
      mimeType: file.type || 'image/*',
      source: 'upload'
    };
    const labelText = document.getElementById('text3dSelectedLabel');
    if (labelText) labelText.textContent = `Selected: ${file.name}`;
  };
  reader.onerror = () => log('3D design label read failed.');
  reader.readAsDataURL(file);
}

function handle3dSaveDesignSubmit(event) {
  event?.preventDefault?.();
  const name = document.getElementById('input3dDesignName')?.value?.trim() || '';
  const selectedTemplateId = document.getElementById('input3dObjectType')?.value?.trim() || '';
  const objectTemplate = getObjectTemplateById(selectedTemplateId);
  const notes = document.getElementById('input3dNotes')?.value?.trim() || '';

  if (!name || !objectTemplate) {
    log('3D design requires Name and Object.');
    return;
  }

  const record = {
    id: generateDesignId(),
    name,
    objectType: objectTemplate.id,
    objectTemplateId: objectTemplate.id,
    notes,
    labelImageDataUrl: modeling3dDraftLabel?.dataUrl || '',
    labelImageFileName: modeling3dDraftLabel?.name || '',
    labelImageMimeType: modeling3dDraftLabel?.mimeType || '',
    labelSource: modeling3dDraftLabel?.source || 'none',
    materialPreset: DESIGN_MATERIAL_PRESET_DEFAULT,
    labelTransform: { ...DESIGN_LABEL_TRANSFORM_DEFAULTS },
    facePlacement: normalizeDesignFacePlacement(DESIGN_FACE_PLACEMENT_DEFAULTS, objectTemplate.id, DESIGN_LABEL_TRANSFORM_DEFAULTS),
    createdAt: new Date().toISOString()
  };

  const records = loadDesignRecords();
  records.unshift(record);
  const didSave = saveDesignRecords(records);
  if (!didSave) {
    log('3D design save failed (local storage unavailable).');
    return;
  }

  modeling3dDraftLabel = null;
  render3dModelingView('saved');
  log(`Saved 3D design: ${name}`);
}

function delete3dDesignById(designId) {
  if (!designId) return;
  const records = loadDesignRecords();
  const next = records.filter(record => record.id !== designId);
  if (next.length === records.length) return;
  const didSave = saveDesignRecords(next);
  if (!didSave) {
    log('Unable to delete design (local storage unavailable).');
    return;
  }
  render3dModelingView('saved');
  log(`Deleted 3D design: ${designId.slice(0, 10)}`);
}

function get3dLabelTransformFromInputs() {
  const readValue = id => document.getElementById(id)?.value;
  return normalizeDesignLabelTransform({
    scalePercent: readValue('input3dLabelScaleNumber') ?? readValue('input3dLabelScale'),
    offsetX: readValue('input3dLabelOffsetXNumber') ?? readValue('input3dLabelOffsetX'),
    offsetY: readValue('input3dLabelOffsetYNumber') ?? readValue('input3dLabelOffsetY'),
    rotationDeg: readValue('input3dLabelRotationNumber') ?? readValue('input3dLabelRotation')
  });
}

function sync3dLabelTransformInputs(transform) {
  const normalized = normalizeDesignLabelTransform(transform);
  const sync = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = String(value);
  };
  sync('input3dLabelScale', normalized.scalePercent);
  sync('input3dLabelScaleNumber', normalized.scalePercent);
  sync('input3dLabelOffsetX', normalized.offsetX);
  sync('input3dLabelOffsetXNumber', normalized.offsetX);
  sync('input3dLabelOffsetY', normalized.offsetY);
  sync('input3dLabelOffsetYNumber', normalized.offsetY);
  sync('input3dLabelRotation', normalized.rotationDeg);
  sync('input3dLabelRotationNumber', normalized.rotationDeg);
}

function getSelected3dFaceIdFromUi() {
  const value = document.getElementById('input3dFaceSelector')?.value;
  return Number(value || 1);
}

function get3dFaceFitModeFromUi() {
  return normalizeDesignFaceFitMode(document.getElementById('input3dLabelFitMode')?.value);
}

function persist3dFacePlacementFromRuntime() {
  if (!modeling3dViewerRuntime || typeof modeling3dViewerRuntime.getFacePlacementState !== 'function') return;
  const facePlacement = modeling3dViewerRuntime.getFacePlacementState();
  const didSave = save3dDesignFacePlacement(modeling3dDisplayedDesignId, facePlacement);
  if (!didSave && modeling3dDisplayedDesignId) {
    log('Unable to persist label placement changes for this design.');
  }
}

function apply3dLabelTransformFromUi() {
  const transform = get3dLabelTransformFromInputs();
  sync3dLabelTransformInputs(transform);
  if (!modeling3dViewerRuntime) return;

  if (typeof modeling3dViewerRuntime.applyLabelTransform === 'function') {
    modeling3dViewerRuntime.applyLabelTransform(transform);
  }

  persist3dFacePlacementFromRuntime();
}

function apply3dFaceFitModeFromUi() {
  const fitMode = get3dFaceFitModeFromUi();
  if (!modeling3dViewerRuntime) return;
  if (typeof modeling3dViewerRuntime.applyFaceFitMode === 'function') {
    modeling3dViewerRuntime.applyFaceFitMode(fitMode);
  }
  persist3dFacePlacementFromRuntime();
}

function handle3dFaceSelectionChange() {
  const faceId = getSelected3dFaceIdFromUi();
  if (!modeling3dViewerRuntime || typeof modeling3dViewerRuntime.setSelectedFace !== 'function') return;
  modeling3dViewerRuntime.setSelectedFace(faceId);
}

function apply3dMaterialPresetFromUi() {
  const materialPreset = normalizeDesignMaterialPreset(document.getElementById('input3dMaterialPreset')?.value);
  if (!modeling3dViewerRuntime || typeof modeling3dViewerRuntime.applyMaterialPreset !== 'function') return;
  modeling3dViewerRuntime.applyMaterialPreset(materialPreset);
  const didSave = save3dDesignMaterialPreset(modeling3dDisplayedDesignId, materialPreset);
  if (!didSave && modeling3dDisplayedDesignId) {
    log('Unable to persist carton finish preset for this design.');
  }
}

function reset3dViewerViewFromUi() {
  if (!modeling3dViewerRuntime || typeof modeling3dViewerRuntime.resetView !== 'function') return;
  modeling3dViewerRuntime.resetView();
}

function reset3dLabelTransform() {
  sync3dLabelTransformInputs(DESIGN_LABEL_TRANSFORM_DEFAULTS);
  apply3dLabelTransformFromUi();
}

function clearLayoutPreview() {
  state.artwork.loaded = false;
  state.artwork.name = '';
  state.artwork.inputPath = '';
  state.artwork.previewDataUrl = '';
  layoutPreviewImage = null;
  layoutPreviewImageSrc = '';

  const fileInput = document.getElementById('pdfInput');
  if (fileInput) fileInput.value = '';

  render();
  persistState();
  log('Cleared active sheet layout preview.');
}

function setConfigFromInputs() {
  const getNum = (id, min, max, fallback) => clamp(document.getElementById(id)?.value, min, max, fallback);
  state.config.host = document.getElementById('cfgHost')?.value?.trim() || state.config.host;
  state.config.commandPort = getNum('cfgCommandPort', 1, 65535, state.config.commandPort);
  state.config.eventPort = getNum('cfgEventPort', 1, 65535, state.config.eventPort);
  state.config.dataPort = getNum('cfgDataPort', 1, 65535, state.config.dataPort);
  state.config.intendedSpeedIps = getNum('cfgIps', 10, 2000, state.config.intendedSpeedIps);
  state.config.pollIntervalMs = getNum('cfgPoll', 200, 10000, state.config.pollIntervalMs);
  const cfgReadOnly = document.getElementById('cfgReadOnlyDiscovery');
  if (cfgReadOnly && typeof cfgReadOnly.checked === 'boolean') {
    state.config.readOnlyDiscovery = Boolean(cfgReadOnly.checked);
  }
  render();
  persistState();
}

function syncConfigInputs() {
  const map = {
    cfgHost: state.config.host,
    cfgCommandPort: state.config.commandPort,
    cfgEventPort: state.config.eventPort,
    cfgDataPort: state.config.dataPort,
    cfgIps: state.config.intendedSpeedIps,
    cfgPoll: state.config.pollIntervalMs
  };
  for (const [id, value] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el && String(el.value) !== String(value)) el.value = value;
  }
  const cfgReadOnly = document.getElementById('cfgReadOnlyDiscovery');
  if (cfgReadOnly && typeof cfgReadOnly.checked === 'boolean') {
    cfgReadOnly.checked = isDiscoveryReadOnlyMode();
  }
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(state.config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rip-ui-prototype-config.json';
  if (typeof a.click === 'function') a.click();
  URL.revokeObjectURL(url);
  log('Exported connection config JSON.');
}

async function hydrateRuntimeConfig() {
  const bridge = getBridge();
  if (!bridge || typeof bridge.getRuntimeConfig !== 'function') return;
  try {
    const runtime = await bridge.getRuntimeConfig();
    const cfg = runtime?.runtimeConfig || {};
    state.config = {
      ...state.config,
      operatorProfile: cfg.operatorProfile || state.config.operatorProfile,
      backendMode: cfg.backendMode || state.config.backendMode,
      host: cfg.host || state.config.host,
      commandPort: cfg.commandPort || state.config.commandPort,
      eventPort: cfg.eventPort || state.config.eventPort,
      dataPort: cfg.dataPort || state.config.dataPort,
      intendedSpeedIps: cfg.intendedSpeedIps || state.config.intendedSpeedIps,
      pollIntervalMs: cfg.pollIntervalMs || state.config.pollIntervalMs,
      bridgeHost: cfg.bridgeHost || state.config.bridgeHost,
      bridgePort: cfg.bridgePort || state.config.bridgePort,
      bridgeBaseUrl: `http://${cfg.bridgeHost || state.config.bridgeHost || '127.0.0.1'}:${cfg.bridgePort || state.config.bridgePort || 8787}`,
      adapterHost: cfg.adapterHost || state.config.adapterHost,
      adapterPort: cfg.adapterPort || state.config.adapterPort
    };
    syncConfigInputs();
    render();
    persistState();
    log(`Loaded runtime profile ${state.config.operatorProfile} (${state.config.backendMode}).`);
  } catch (error) {
    log(`Runtime profile load failed: ${getActionableError(error)}`);
  }
}

function importConfigFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(String(e.target.result || '{}'));
      state.config = { ...state.config, ...parsed };
      syncConfigInputs();
      render();
      persistState();
      log('Imported connection config JSON.');
    } catch (error) {
      log(`Config import failed: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

async function testEndpoint(name, port) {
  const bridge = getBridge();
  let ok = Number(port) > 0 && String(state.config.host).trim().length > 0;
  const stamp = new Date().toISOString();

  if (bridge && typeof bridge.testEndpoint === 'function') {
    try {
      const result = await bridge.testEndpoint({ host: state.config.host, port, kind: name });
      ok = Boolean(result?.ok);
      if (!ok && result?.message) {
        log(`Connectivity probe failed (${name}): ${result.message}`);
      }
    } catch (error) {
      ok = false;
      log(`Connectivity probe error (${name}): ${getActionableError(error)}`);
    }
  }

  state.connectionTests[name] = ok ? `OK ${stamp}` : `FAILED ${stamp}`;
  log(`Connectivity test (${name}) => ${state.connectionTests[name]} (non-destructive probe).`);
  render();
  persistState();
}

function getBridge() {
  if (typeof window !== 'undefined' && window.ripBridge) return window.ripBridge;
  return null;
}

function getBridgeHealth() {
  const bridge = getBridge();
  const hasBridge = Boolean(bridge);
  const canRunCommand = hasBridge && typeof bridge.runCommand === 'function';
  return {
    bridge,
    hasBridge,
    canRunCommand,
    label: hasBridge ? 'HTTP BRIDGE CONNECTED' : 'BRIDGE UNAVAILABLE'
  };
}

function formatEligibilitySummary(checks) {
  const blocked = checks.filter(item => item.level === 'block');
  const warnings = checks.filter(item => item.level === 'warn');
  const outcome = blocked.length > 0 ? 'blocked' : warnings.length > 0 ? 'warn' : 'ready';
  const reasons = [...blocked, ...warnings]
    .map(item => `${item.level.toUpperCase()}: ${item.message} | remediation: ${item.remediation}`);
  return { outcome, reasons };
}

function createStatusAdapter() {
  const bridge = getBridge();
  if (bridge && typeof bridge.getStatus === 'function') {
    return {
      source: 'bridge-http',
      async fetchStatus(config) {
        return bridge.getStatus(config);
      }
    };
  }

  return {
    source: 'bridge-down',
    async fetchStatus() {
      throw new Error('BRIDGE_UNAVAILABLE: HTTP bridge IPC contract is missing. Restart Electron and bridge service.');
    }
  };
}

const statusAdapter = createStatusAdapter();
let pollTimer = null;
let staleTimer = null;
let streamUnsubscribe = null;

function statusDebugEnabled() {
  try {
    if (typeof localStorage === 'undefined') return false;
    const flag = String(localStorage.getItem('rip-status-debug') || '').trim().toLowerCase();
    return flag === '1' || flag === 'true' || flag === 'on';
  } catch {
    return false;
  }
}

function firstDefinedString(...values) {
  for (const value of values) {
    const str = String(value || '').trim();
    if (str) return str;
  }
  return '';
}

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
    || src.match(/engineStatus\.state\s*[=:]\s*(\d{1,3})/i);
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

function resolveEngineState(status = {}) {
  const details = status?.details || {};
  const productInfo = details?.productInfo || {};

  const directCandidates = [
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
  let numeric = Number.isInteger(status?.engineStateRawNumeric)
    ? Number(status.engineStateRawNumeric)
    : null;

  for (const [source, value] of directCandidates) {
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
        ['status.raw', status?.raw]
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

  const canonical = rawLabel || (numeric != null ? ENGINE_STATE_VALUE_TO_NAME[numeric] || '' : '');
  const canonicalUi = ENGINE_STATE_NAME_TO_UI[canonical] || (canonical || 'UNKNOWN');
  const displayRawLabel = rawLabel || (numeric != null ? `STATE_${numeric}` : 'UNKNOWN');

  return {
    engineState: canonicalUi,
    rawLabel: displayRawLabel,
    canonical: canonical || null,
    numeric,
    extraction
  };
}

function parseInkLevelsFromStatus(status = {}) {
  const direct = status?.inkLevels;
  if (direct && typeof direct === 'object') {
    return {
      C: Math.max(0, Math.min(100, Number(direct.C) || 0)),
      M: Math.max(0, Math.min(100, Number(direct.M) || 0)),
      Y: Math.max(0, Math.min(100, Number(direct.Y) || 0)),
      K: Math.max(0, Math.min(100, Number(direct.K) || 0))
    };
  }

  const details = status?.details || {};
  const output = String(details?.productInfo?.output || '');
  if (!output) return null;

  const byColor = {};
  const tankRegex = /InkTankStatus\(([^)]*)\)/g;
  let match;
  while ((match = tankRegex.exec(output)) !== null) {
    const chunk = match[1] || '';
    const cap = Number((chunk.match(/inkCapacity\s*=\s*([0-9.]+)/i) || [])[1]);
    const rem = Number((chunk.match(/inkRemaining\s*=\s*([0-9.]+)/i) || [])[1]);
    const color = Number((chunk.match(/color\s*=\s*(\d+)/i) || [])[1]);
    if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(rem) || !Number.isInteger(color)) continue;
    const pct = Math.max(0, Math.min(100, Math.round((rem / cap) * 100)));
    byColor[color] = pct;
  }

  if (!Object.keys(byColor).length) return null;
  return {
    C: Number.isFinite(byColor[1]) ? byColor[1] : 0,
    M: Number.isFinite(byColor[2]) ? byColor[2] : 0,
    Y: Number.isFinite(byColor[3]) ? byColor[3] : 0,
    K: Number.isFinite(byColor[4]) ? byColor[4] : 0
  };
}

function normalizeLiveStatus(rawStatus = {}, fallbackSource = 'bridge-http') {
  const status = rawStatus || {};
  const details = status?.details || {};
  const resolved = resolveEngineState(status);

  return {
    engineState: resolved.engineState,
    engineStateRawNumeric: resolved.numeric,
    engineStateRawLabel: resolved.rawLabel,
    engineStateCanonical: resolved.canonical,
    queueLength: Number(status?.queueLength ?? details?.queueLength ?? 0),
    faults: Array.isArray(status?.faults) ? status.faults : [],
    inkLevels: parseInkLevelsFromStatus(status),
    timestamp: status?.timestamp || status?.lastUpdate || new Date().toISOString(),
    source: status?.source || fallbackSource,
    _engineStateDebug: resolved
  };
}

function applyLiveStatus(status = {}, { channel = 'status-update' } = {}) {
  const mapped = normalizeLiveStatus(status, state.liveStatus.source || statusAdapter.source || 'bridge-http');

  if (statusDebugEnabled()) {
    log(`[status-debug] channel=${channel} extraction=${mapped?._engineStateDebug?.extraction || 'unknown'} numeric=${mapped?._engineStateDebug?.numeric ?? 'n/a'} raw=${mapped?._engineStateDebug?.rawLabel || 'n/a'} canonical=${mapped?._engineStateDebug?.canonical || 'n/a'} ui=${mapped.engineState}`);
  }

  state.liveStatus.engineState = mapped.engineState;
  state.liveStatus.engineStateRawNumeric = mapped.engineStateRawNumeric;
  state.liveStatus.engineStateRawLabel = mapped.engineStateRawLabel;
  state.liveStatus.engineStateCanonical = mapped.engineStateCanonical;
  state.liveStatus.queueLength = mapped.queueLength;
  state.liveStatus.faults = mapped.faults;
  if (mapped.inkLevels && typeof mapped.inkLevels === 'object') {
    state.liveStatus.inkLevels = mapped.inkLevels;
  } else if (!state.liveStatus.inkLevels) {
    state.liveStatus.inkLevels = { C: 0, M: 0, Y: 0, K: 0 };
  }
  state.liveStatus.lastUpdate = mapped.timestamp;
  state.liveStatus.source = mapped.source;
  state.liveStatus.streamConnected = true;

  const liveEngineUpper = String(mapped.engineState || '').toUpperCase();
  if (['IDLE', 'READY'].includes(liveEngineUpper)) {
    const printingJob = state.jobs.find(job => String(job.status || '').toLowerCase() === 'printing');
    if (printingJob) {
      printingJob.status = 'done';
      state.queue.push(`complete(${printingJob.id}) via ${channel}`);
      log(`Print finished for ${printingJob.id}; queue advancing.`);
      refreshQueueDepth();
    }
  }

  tryAutoDispatchNextJob(channel);
  render();
  persistState();
}

function markStatusStreamStale(reason = 'Status stream stale') {
  state.liveStatus.engineState = 'UNKNOWN';
  state.liveStatus.engineStateRawNumeric = null;
  state.liveStatus.engineStateRawLabel = 'UNKNOWN';
  state.liveStatus.engineStateCanonical = 'UNKNOWN';
  state.liveStatus.streamConnected = false;
  state.liveStatus.source = 'bridge-down';
  state.liveStatus.faults = [`STATUS_STALE: ${reason}`];
  state.liveStatus.inkLevels = { C: 0, M: 0, Y: 0, K: 0 };
  state.liveStatus.lastUpdate = new Date().toISOString();
  render();
}

function stopStatusPolling() {
  if (pollTimer) clearInterval(pollTimer);
  if (staleTimer) clearInterval(staleTimer);
  pollTimer = null;
  staleTimer = null;

  if (typeof streamUnsubscribe === 'function') {
    streamUnsubscribe();
  }
  streamUnsubscribe = null;

  const bridge = getBridge();
  if (bridge && typeof bridge.unsubscribeStatusStream === 'function') {
    bridge.unsubscribeStatusStream();
  }

  state.liveStatus.running = false;
  state.liveStatus.streamConnected = false;
  render();
  persistState();
}

function startStatusPolling() {
  stopStatusPolling();
  state.liveStatus.source = statusAdapter.source;
  state.liveStatus.running = true;

  let fallbackPollInFlight = false;

  const runFallbackPoll = async () => {
    if (fallbackPollInFlight) return;
    fallbackPollInFlight = true;

    try {
      const status = await statusAdapter.fetchStatus(state.config);
      applyLiveStatus(status || {}, { channel: 'status-fallback-poll' });
    } catch (error) {
      const actionable = getActionableError(error);
      state.liveStatus.engineState = 'DOWN';
      state.liveStatus.engineStateRawNumeric = null;
      state.liveStatus.engineStateRawLabel = 'UNKNOWN';
      state.liveStatus.engineStateCanonical = 'UNKNOWN';
      state.liveStatus.source = 'bridge-down';
      state.liveStatus.streamConnected = false;
      state.liveStatus.faults = [`STATUS_ERR: ${actionable}`];
      state.liveStatus.inkLevels = { C: 0, M: 0, Y: 0, K: 0 };
      state.liveStatus.lastUpdate = new Date().toISOString();
      log(`Status polling error: ${actionable}`);
      render();
    } finally {
      fallbackPollInFlight = false;
    }
  };

  const ensureFallbackPolling = (reason = 'status stream unavailable') => {
    if (pollTimer) return;
    runFallbackPoll();
    pollTimer = setInterval(runFallbackPoll, state.config.pollIntervalMs);
    log(`Fallback polling active (${reason}, interval=${state.config.pollIntervalMs}ms).`);
  };

  const bridge = getBridge();
  if (bridge && typeof bridge.subscribeStatusStream === 'function') {
    try {
      let lastInkHydrateAt = 0;
      streamUnsubscribe = bridge.subscribeStatusStream(({ type, payload }) => {
        if (type === 'open') {
          state.liveStatus.streamConnected = true;
          state.liveStatus.source = 'bridge-sse';
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
            log('Fallback polling paused; SSE stream is active.');
          }
          render();
          return;
        }

        if (type === 'update') {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
            log('Fallback polling stopped after SSE update.');
          }
          const snapshot = payload || {};
          applyLiveStatus(snapshot, { channel: 'status-sse' });

          const missingInk = !snapshot?.inkLevels || Object.values(snapshot.inkLevels || {}).every(v => Number(v) === 0);
          const now = Date.now();
          if (missingInk && now - lastInkHydrateAt > 5000) {
            lastInkHydrateAt = now;
            runFallbackPoll();
          }
          return;
        }

        if (type === 'error') {
          state.liveStatus.streamConnected = false;
          state.liveStatus.source = 'bridge-down';
          state.liveStatus.faults = [`STATUS_ERR: ${payload?.message || 'stream error'}`];
          render();
          ensureFallbackPolling('sse-error');
        }
      });

      staleTimer = setInterval(() => {
        const ageMs = state.liveStatus.lastUpdate ? Date.now() - Date.parse(state.liveStatus.lastUpdate) : Number.POSITIVE_INFINITY;
        if (!Number.isFinite(ageMs) || ageMs > Math.max(5000, Number(state.config.pollIntervalMs || 1000) * 3)) {
          markStatusStreamStale('No update received from SSE stream');
          ensureFallbackPolling('sse-stale');
        }
      }, 1000);

      log('Status streaming started (bridge-sse, heartbeat=1000ms).');
      return;
    } catch (error) {
      log(`Status stream setup failed, enabling fallback polling: ${getActionableError(error)}`);
      ensureFallbackPolling('sse-setup-failed');
      return;
    }
  }

  ensureFallbackPolling('sse-not-available');
}

function computeEligibility(command) {
  const checks = [];
  const normalizedCommand = UI_COMMAND_SIM_MAP[command] || command;

  if (isDiscoveryReadOnlyMode()) {
    checks.push({
      level: 'block',
      message: 'Discovery lock is enabled (read-only mode).',
      remediation: 'Disable Discovery Lock before running mutating print commands.'
    });
  }

  if (!state.liveStatus.running) {
    checks.push({
      level: 'warn',
      message: 'Status polling is not running; commands can proceed with reduced live telemetry.',
      remediation: 'Start status polling to improve safety visibility before mutating operations.'
    });
  }

  if (normalizedCommand === 'print_prepare' && state.jobs.every(j => j.status !== 'queued')) {
    checks.push({
      level: 'warn',
      message: 'No queued jobs detected for prepare-to-print.',
      remediation: 'Queue a job if this prepare is for active production output.'
    });
  }

  if (normalizedCommand === 'print_start' && !state.preflight.passed) {
    checks.push({
      level: 'warn',
      message: 'Preflight has not passed for this session.',
      remediation: 'Run preflight checks before production start when possible.'
    });
  }

  const engine = String(state.liveStatus.engineState || 'UNKNOWN').toUpperCase();
  if (['FAULT', 'ERROR', 'NOT_READY'].includes(engine)) {
    checks.push({
      level: 'block',
      message: `Engine reported ${engine}.`,
      remediation: 'Resolve fault and refresh status before running mutating commands.'
    });
  }

  if (engine === 'UNKNOWN') {
    checks.push({
      level: 'warn',
      message: 'Live engine state is UNKNOWN (soft gating).',
      remediation: 'Verify connectivity and status telemetry, then proceed cautiously.'
    });
  }

  return checks;
}

function commandPrecondition(command) {
  const blocked = computeEligibility(command).find(item => item.level === 'block');
  return blocked ? `${blocked.message} Remediation: ${blocked.remediation}` : '';
}

function commandRequiresConfirmation(command) {
  return COMMANDS.some(c => c.name === command && c.mutating);
}

function renderEligibility() {
  const el = document.getElementById('eligibilityPreview');
  if (!el) return;

  const rows = COMMANDS.map(cmd => {
    const checks = computeEligibility(cmd.name);
    const blocked = checks.find(item => item.level === 'block');
    const warn = checks.find(item => item.level === 'warn');
    const stateLabel = blocked ? 'BLOCKED' : warn ? 'WARN' : 'READY';
    const detail = blocked || warn;
    return `${cmd.name.toUpperCase()}: ${stateLabel}${detail ? `\n- ${detail.message}\n- remediation: ${detail.remediation}` : ''}`;
  });

  el.textContent = rows.join('\n\n');
}

async function executeCommand(command) {
  const clickTs = new Date().toISOString();
  log(`CMD click: ${command} @ ${clickTs}`);

  const checks = computeEligibility(command);
  const eligibility = formatEligibilitySummary(checks);
  log(
    eligibility.reasons.length > 0
      ? `CMD eligibility: ${command} => ${eligibility.outcome} | ${eligibility.reasons.join(' || ')}`
      : `CMD eligibility: ${command} => ready`
  );

  const bridgeHealth = getBridgeHealth();
  log(`CMD bridge: present=${bridgeHealth.hasBridge} runCommandCallable=${bridgeHealth.canRunCommand}`);

  const issue = commandPrecondition(command);
  state.commandError = issue;
  if (issue) {
    log(`Blocked command ${command}: ${issue}`);
    await appendAudit({ type: 'command', command, outcome: 'blocked', reason: issue, settings: deepClone(state.config) });
    render();
    persistState();
    return;
  }

  if (commandRequiresConfirmation(command) && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    const confirmed = window.confirm(`Confirm mutating command: ${command.toUpperCase()}\n\nThis may change live engine/job state.`);
    if (!confirmed) {
      log(`Command cancelled by operator confirmation: ${command}`);
      await appendAudit({ type: 'command', command, outcome: 'cancelled' });
      return;
    }
  }

  if (bridgeHealth.canRunCommand) {
    const payload = { command, config: state.config };
    const headPosition = command === 'head_cap' ? 'capped' : (command === 'head_raise' ? 'raised' : (command === 'head_print' ? 'print' : null));
    const headPrintUnits = [];
    log(
      `CMD dispatch payload: command=${command} host=${state.config.host}:${state.config.commandPort} backendMode=${state.config.backendMode}`
    );
    if (headPosition) {
      log(`HEAD control dispatch: ${command} -> startMovingPrintheads(printUnits=${JSON.stringify(headPrintUnits)}, position=${headPosition})`);
    }
    try {
      const result = await bridgeHealth.bridge.runCommand(payload);
      const accepted = Boolean(result?.accepted);
      const simulatedResponse = hasSimulatedSignal(result?.bridgeResult) || hasSimulatedSignal(result?.bridgeError) || hasSimulatedSignal(result?.message);
      const responseMessage = result?.message || result?.status || 'no-message';
      const responseSource = result?.source || 'bridge';
      log(`CMD bridge response: ${accepted ? 'accepted' : 'rejected'} | message=${responseMessage} | source=${responseSource}`);

      if (headPosition && accepted && simulatedResponse) {
        state.commandError = `HEAD ${headPosition.toUpperCase()} failed: simulated/shim/no-op response rejected`;
        log(`CMD bridge rejection: ${state.commandError}`);
        await appendAudit({ type: 'command', command, outcome: 'rejected', reason: state.commandError, result });
        render();
        persistState();
        return;
      }

      if (!accepted) {
        state.commandError = responseMessage;
        if (headPosition) {
          state.commandError = `HEAD ${headPosition.toUpperCase()} failed: ${responseMessage}`;
        }
        await appendAudit({ type: 'command', command, outcome: 'rejected', reason: state.commandError, result });
        render();
        persistState();
        return;
      }

      await appendAudit({ type: 'command', command, outcome: 'executed', result });
    } catch (error) {
      const actionable = getActionableError(error);
      const rawCode = error?.code || error?.bridgeError?.code || error?.error?.code || 'n/a';
      const rawMessage = error?.message || error?.bridgeError?.message || error?.error?.message || 'n/a';
      state.commandError = actionable;
      if (headPosition) {
        state.commandError = `HEAD ${headPosition.toUpperCase()} failed: ${actionable}`;
      }
      log(`CMD bridge error: ${state.commandError} | rawCode=${rawCode} | rawMessage=${rawMessage}`);
      await appendAudit({ type: 'command', command, outcome: 'error', error: state.commandError, rawCode, rawMessage });
      render();
      persistState();
      return;
    }
  }

  state.commandError = 'BRIDGE_UNAVAILABLE: HTTP bridge IPC endpoint is missing. Restart Electron + bridge service.';
  log(state.commandError);
  await appendAudit({ type: 'command', command, outcome: 'error', error: state.commandError });
  render();
  persistState();
}

function bindPlacementControls() {
  const placementIds = ['mediaWidth', 'mediaHeight', 'rotationDeg', 'offsetX', 'offsetY'];
  placementIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('focus', () => JOB_NUMERIC_EDITING_IDS.add(id));
    el.addEventListener('input', () => JOB_NUMERIC_EDITING_IDS.add(id));
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        applyPlacementFromInputs(id);
        JOB_NUMERIC_EDITING_IDS.delete(id);
        el.blur();
      }
    });
    el.addEventListener('blur', () => {
      applyPlacementFromInputs(id);
      JOB_NUMERIC_EDITING_IDS.delete(id);
    });
    el.addEventListener('change', () => applyPlacementFromInputs(id));
  });

  const pageSizePresetEl = document.getElementById('pageSizePreset');
  if (pageSizePresetEl && typeof pageSizePresetEl.addEventListener === 'function') {
    pageSizePresetEl.addEventListener('change', applyPageSizeControlsFromInputs);
  }

  const pageOrientationEl = document.getElementById('pageOrientation');
  if (pageOrientationEl && typeof pageOrientationEl.addEventListener === 'function') {
    pageOrientationEl.addEventListener('change', applyPageSizeControlsFromInputs);
  }
}

function setAlign(axis, value) {
  if (axis === 'x') state.artwork.placement.alignX = value;
  if (axis === 'y') state.artwork.placement.alignY = value;
  render();
  persistState();
}

function toggleFlip(axis) {
  if (axis === 'x') state.artwork.placement.flipHorizontal = !state.artwork.placement.flipHorizontal;
  if (axis === 'y') state.artwork.placement.flipVertical = !state.artwork.placement.flipVertical;
  render();
  persistState();
}

function normalizeRotationDeg(value) {
  let normalized = Number(value);
  if (!Number.isFinite(normalized)) normalized = 0;
  normalized = ((normalized + 180) % 360 + 360) % 360 - 180;
  if (normalized === -180) return 180;
  return normalized;
}

function rotateArtworkBy90() {
  const p = state.artwork.placement;
  p.rotationDeg = normalizeRotationDeg((Number(p.rotationDeg) || 0) + 90);
  render();
  persistState();
}

function toggleAutoSend() {
  if (!state.controls) state.controls = deepClone(INITIAL_STATE.controls);
  state.controls.autoSendEnabled = !state.controls.autoSendEnabled;
  log(`Auto-send ${state.controls.autoSendEnabled ? 'enabled' : 'paused'} by operator.`);
  if (state.controls.autoSendEnabled) {
    tryAutoDispatchNextJob('toggle-on');
  }
  render();
  persistState();
}

function toggleDiscoveryMode() {
  state.config.readOnlyDiscovery = !isDiscoveryReadOnlyMode();
  state.commandError = '';
  log(`Discovery lock ${isDiscoveryReadOnlyMode() ? 'enabled (read-only)' : 'disabled (mutating commands allowed)'}.`);
  render();
  persistState();
}

function applyArrangeInputs() {
  if (!state.ui) state.ui = deepClone(INITIAL_STATE.ui);
  if (!state.ui.arrange) state.ui.arrange = deepClone(INITIAL_STATE.ui.arrange);
  const a = state.ui.arrange;
  const spacingMaxIn = mmToIn(5000);
  a.gapHorizontalMm = inToMm(clamp(document.getElementById('gapHorizontal')?.value, 0, spacingMaxIn, mmToIn(a.gapHorizontalMm)));
  a.gapVerticalMm = inToMm(clamp(document.getElementById('gapVertical')?.value, 0, spacingMaxIn, mmToIn(a.gapVerticalMm)));
  a.copyHorizontalCount = clamp(document.getElementById('copyHorizontalCount')?.value, 1, 200, a.copyHorizontalCount);
  a.copyVerticalCount = clamp(document.getElementById('copyVerticalCount')?.value, 1, 200, a.copyVerticalCount);
  a.copyHorizontalSpacingMm = inToMm(clamp(document.getElementById('copyHorizontalSpacing')?.value, 0, spacingMaxIn, mmToIn(a.copyHorizontalSpacingMm)));
  a.copyVerticalSpacingMm = inToMm(clamp(document.getElementById('copyVerticalSpacing')?.value, 0, spacingMaxIn, mmToIn(a.copyVerticalSpacingMm)));
  a.copyIntervalIncludesSize = Boolean(document.getElementById('copyIntervalIncludesSize')?.checked);
  render();
  persistState();
}


function selectJobRow(jobId) {
  if (!jobId) return;
  if (!state.ui) state.ui = deepClone(INITIAL_STATE.ui);
  state.ui.selectedJobId = jobId;
  render();
  persistState();
}

function bindJobTableInteractions() {
  const table = document.getElementById('jobTable');
  if (!table || typeof table.addEventListener !== 'function') return;

  table.addEventListener('click', event => {
    const row = event.target?.closest?.('tr[data-job-id]');
    if (!row) return;
    selectJobRow(row.dataset.jobId);
  });

  table.addEventListener('keydown', event => {
    const row = event.target?.closest?.('tr[data-job-id]');
    if (!row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectJobRow(row.dataset.jobId);
    }
  });
}

function bindPdfInputs() {
  const fileInput = document.getElementById('pdfInput');
  const dropZone = document.getElementById('dropZone');

  if (fileInput && typeof fileInput.addEventListener === 'function') {
    fileInput.addEventListener('change', event => {
      const [file] = event.target.files || [];
      handleArtworkFile(file);
    });
  }

  if (!dropZone || typeof dropZone.addEventListener !== 'function') return;

  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, e => {
      e.preventDefault();
      dropZone.classList.add('is-dragging');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, e => {
      e.preventDefault();
      dropZone.classList.remove('is-dragging');
    });
  });

  dropZone.addEventListener('drop', event => {
    const [file] = event.dataTransfer?.files || [];
    handleArtworkFile(file);
  });
}

function bindTopTabs() {
  const tabs = ['printhead', 'jobs'];

  tabs.forEach(name => {
    const tabEl = document.getElementById(name === 'jobs' ? 'tabJobSubmission' : 'tabPrintheadControls');
    if (!tabEl || typeof tabEl.addEventListener !== 'function') return;
    tabEl.addEventListener('click', () => setTopTab(name));
  });

  const tablist = document.getElementById('topTabs');
  if (tablist && typeof tablist.addEventListener === 'function') {
    tablist.addEventListener('keydown', event => {
      const current = state.ui?.topTab === 'jobs' ? 1 : 0;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const dir = event.key === 'ArrowRight' ? 1 : -1;
        const next = (current + dir + tabs.length) % tabs.length;
        setTopTab(tabs[next], { focus: true });
      } else if (event.key === 'Home') {
        event.preventDefault();
        setTopTab('printhead', { focus: true });
      } else if (event.key === 'End') {
        event.preventDefault();
        setTopTab('jobs', { focus: true });
      }
    });
  }

  syncTopTabUI();
}

function bindLeftSidebarTabs() {
  // Left column is intake-only on the operator screen.
  syncLeftSidebarTabUI();
}

function bindRightSidebarTabs() {
  // Live status/logs remains pinned as a permanent right sidebar.
  syncRightSidebarTabUI();
}

function bindJobArrangeTabs() {
  syncJobArrangeTabUI();
}

function bind() {
  const commandGroups = {
    controlsCleaning: [
      { command: 'clean_light', label: 'Light' },
      { command: 'clean_medium', label: 'Medium' },
      { command: 'clean_heavy', label: 'Heavy' }
    ],
    controlsEngine: [
      { command: 'engine_initialise', label: 'Initialise' },
      { command: 'engine_shutdown', label: 'Shutdown' },
      { command: 'engine_replace_wipers', label: 'Replace Wipers' }
    ],
    controlsPriming: [
      { command: 'prime_begin', label: 'Begin Priming' },
      { command: 'deprime_begin', label: 'Begin Depriming' }
    ],
    controlsHead: [
      { command: 'head_cap', label: 'Cap' },
      { command: 'head_raise', label: 'Raise' },
      { command: 'head_print', label: 'Print' }
    ],
    controlsPrint: [
      { command: 'print_prepare', label: 'Prepare to Print' },
      { command: 'print_pause', label: 'Pause' },
      { command: 'print_start', label: 'Start Print' },
      { command: 'print_finish', label: 'Finish Printing' }
    ]
  };

  Object.entries(commandGroups).forEach(([containerId, entries]) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = entries
      .map(entry => {
        const cmd = COMMANDS.find(item => item.name === entry.command);
        if (!cmd) return '';
        const label = entry.label || cmd.label;
        return `<button data-c="${cmd.name}" class="cmd-btn">${label}</button>`;
      })
      .join('');
  });

  const legacyControls = document.getElementById('controls');
  if (legacyControls) {
    legacyControls.innerHTML = COMMANDS.map(cmd => {
      return `<button data-c="${cmd.name}" class="cmd-btn">${cmd.label}</button>`;
    }).join('');
  }

  getCommandButtons().forEach(btn => {
    btn.onclick = () => executeCommand(btn.dataset.c);
  });

  const bindClick = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  };

  bindClick('btnOpen3dPreview', open3dPreviewPlaceholder);
  bindClick('btnOpenSendJobModal', openSendJobDialog);
  bindClick('btnAddJob', addMockJob);
  bindClick('btnDiscover', runDiscovery);
  bindClick('btnRunSimulation', runPipelineSimulation);
  bindClick('btnRunFault', runFaultScenario);
  bindClick('btnRunRecovery', runRecoveryScenario);
  bindClick('btnExportState', exportState);
  bindClick('btnResetState', resetState);
  bindClick('btnExportAuditJson', () => exportAudit('json'));
  bindClick('btnExportAuditNdjson', () => exportAudit('ndjson'));
  bindClick('btnApplyAuditRetention', pruneAuditNow);
  bindClick('btnStopPolling', stopStatusPolling);
  bindClick('btnExportConfig', exportConfig);
  bindClick('btnRunPreflight', runPreflightChecks);
  bindClick('btnSubmitDataPlane', submitDataPlaneJob);
  bindClick('btnAlignLeft', () => setAlign('x', 'left'));
  bindClick('btnAlignCenter', () => setAlign('x', 'center'));
  bindClick('btnAlignRight', () => setAlign('x', 'right'));
  bindClick('btnAlignTop', () => setAlign('y', 'top'));
  bindClick('btnAlignMiddle', () => setAlign('y', 'middle'));
  bindClick('btnAlignBottom', () => setAlign('y', 'bottom'));
  bindClick('btnAutoSendToggle', toggleAutoSend);
  bindClick('btnToggleDiscoveryMode', toggleDiscoveryMode);
  bindClick('btnFlipHorizontal', () => toggleFlip('x'));
  bindClick('btnFlipVertical', () => toggleFlip('y'));
  bindClick('btnRotate90', () => rotateArtworkBy90());
  bindClick('btnClearLayoutPreview', clearLayoutPreview);
  bindClick('btn3dNewDesign', handle3dNewDesignClick);
  bindClick('btn3dSavedDesigns', handle3dSavedDesignsClick);
  bindClick('btnTestCommand', () => testEndpoint('command', state.config.commandPort));
  bindClick('btnTestEvent', () => testEndpoint('event', state.config.eventPort));
  bindClick('btnTestData', () => testEndpoint('data', state.config.dataPort));

  const sendJobForm = document.getElementById('sendJobForm');
  if (sendJobForm && typeof sendJobForm.addEventListener === 'function') {
    sendJobForm.addEventListener('submit', async event => {
      event.preventDefault();
      const copies = getRequestedCopies();
      closeSendJobDialog();
      await handleSendJobCopies(copies);
    });
  }

  const sendJobDialog = document.getElementById('sendJobDialog');
  if (sendJobDialog && typeof sendJobDialog.addEventListener === 'function') {
    sendJobDialog.addEventListener('cancel', () => {
      log('Send Job dialog cancelled by operator.');
    });
  }

  const modeling3dDialog = document.getElementById('modeling3dDialog');
  if (modeling3dDialog && typeof modeling3dDialog.addEventListener === 'function') {
    modeling3dDialog.addEventListener('cancel', () => {
      destroy3dViewerRuntime();
      render3dModelingView('home');
      log('3D Modeling shell closed by operator.');
    });
    modeling3dDialog.addEventListener('close', () => {
      destroy3dViewerRuntime();
      render3dModelingView('home');
      log('3D Modeling shell closed.');
    });
  }

  const modeling3dBody = document.getElementById('modeling3dBody');
  if (modeling3dBody && typeof modeling3dBody.addEventListener === 'function') {
    modeling3dBody.addEventListener('click', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.id === 'btn3dNewDesign') handle3dNewDesignClick();
      if (target.id === 'btn3dSavedDesigns') handle3dSavedDesignsClick();
      if (target.id === 'btn3dCancelDesign' || target.id === 'btn3dSavedBack') render3dModelingView('home');
      if (target.id === 'btn3dDisplayBack') render3dModelingView('saved');
      if (target.id === 'btn3dSaveDesign') handle3dSaveDesignSubmit();
      if (target.id === 'btn3dLabelResetTransform') reset3dLabelTransform();
      if (target.id === 'btn3dResetView') reset3dViewerViewFromUi();
      if (target.id === 'btn3dUseCurrentLabel') {
        const source = getCurrentJobLabelSource();
        if (!source) {
          log('No current job label is available.');
          return;
        }
        modeling3dDraftLabel = source;
        const labelText = document.getElementById('text3dSelectedLabel');
        if (labelText) labelText.textContent = `Selected: ${source.name} (from current job)`;
      }
      if (target.classList.contains('btn3dDisplayDesign')) {
        display3dDesignById(target.getAttribute('data-design-id') || '');
      }
      if (target.classList.contains('btn3dDeleteDesign')) {
        delete3dDesignById(target.getAttribute('data-design-id') || '');
      }
    });

    modeling3dBody.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target instanceof HTMLInputElement && target.id === 'input3dLabelFile') {
        const [file] = target.files || [];
        handle3dLabelFileChange(file);
        return;
      }
      if (target.id === 'input3dFaceSelector') {
        handle3dFaceSelectionChange();
        return;
      }
      if (target.id === 'input3dLabelFitMode') {
        apply3dFaceFitModeFromUi();
        return;
      }
      if (target.id === 'input3dMaterialPreset') {
        apply3dMaterialPresetFromUi();
        return;
      }
      if (target.id.startsWith('input3dLabel')) {
        apply3dLabelTransformFromUi();
      }
    });

    modeling3dBody.addEventListener('input', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.id.startsWith('input3dLabel') && target.id !== 'input3dLabelFile' && target.id !== 'input3dLabelFitMode') {
        apply3dLabelTransformFromUi();
      }
    });

  }

  bindClick('btnCancelSendJob', closeSendJobDialog);
  bindClick('btnClose3dModeling', close3dModelingDialog);
  bindClick('btnClose3dModelingX', close3dModelingDialog);

  const configImport = document.getElementById('configImport');
  if (configImport && typeof configImport.addEventListener === 'function') {
    configImport.addEventListener('change', event => {
      const [file] = event.target.files || [];
      importConfigFile(file);
    });
  }

  ['cfgHost', 'cfgCommandPort', 'cfgEventPort', 'cfgDataPort', 'cfgIps', 'cfgPoll'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('input', setConfigFromInputs);
    el.addEventListener('change', setConfigFromInputs);
  });

  ['auditRetentionMax'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('input', setAuditRetentionFromInputs);
    el.addEventListener('change', setAuditRetentionFromInputs);
  });

  ['auditFilterType'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('change', setAuditFilterFromInputs);
  });

  const arrangeNumericIds = ['gapHorizontal', 'gapVertical', 'copyHorizontalCount', 'copyVerticalCount', 'copyHorizontalSpacing', 'copyVerticalSpacing'];
  arrangeNumericIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el || typeof el.addEventListener !== 'function') return;
    el.addEventListener('focus', () => JOB_NUMERIC_EDITING_IDS.add(id));
    el.addEventListener('input', () => JOB_NUMERIC_EDITING_IDS.add(id));
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        applyArrangeInputs();
        JOB_NUMERIC_EDITING_IDS.delete(id);
        el.blur();
      }
    });
    el.addEventListener('blur', () => {
      applyArrangeInputs();
      JOB_NUMERIC_EDITING_IDS.delete(id);
    });
    el.addEventListener('change', applyArrangeInputs);
  });

  const copyIntervalEl = document.getElementById('copyIntervalIncludesSize');
  if (copyIntervalEl && typeof copyIntervalEl.addEventListener === 'function') {
    copyIntervalEl.addEventListener('change', applyArrangeInputs);
  }

  READ_ONLY_ACTIONS.forEach(item => {
    const btn = document.getElementById(item.id);
    if (btn && btn.classList?.add) btn.classList.add('btn-readonly');
  });

  bindPdfInputs();
  bindPlacementControls();
  bindJobTableInteractions();
  bindTopTabs();
  bindLeftSidebarTabs();
  bindRightSidebarTabs();
  bindJobArrangeTabs();
  syncConfigInputs();
}

bind();
refreshQueueDepth();
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('resize', () => {
    renderLayoutRuler();
    renderLayoutPreview();
  });
}
render();
startStatusPolling();
hydrateRuntimeConfig();
if (state.logs.length === 0) {
  log('Prototype boot complete in live-operator mode (no auto command dispatch).');
  log('Status streaming starts automatically on load with fallback polling if needed.');
} else {
  log('Prototype resumed from local JSON persistence.');
}
