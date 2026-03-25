function createLogger({ level = 'info' } = {}) {
  const levels = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = levels[level] || levels.info;

  function log(logLevel, payload = {}) {
    if ((levels[logLevel] || 999) < threshold) return;
    const row = {
      ts: new Date().toISOString(),
      level: logLevel,
      ...payload
    };
    process.stdout.write(`${JSON.stringify(row)}\n`);
  }

  return {
    debug: payload => log('debug', payload),
    info: payload => log('info', payload),
    warn: payload => log('warn', payload),
    error: payload => log('error', payload)
  };
}

module.exports = { createLogger };
