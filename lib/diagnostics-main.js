// Main-process diagnostics: structured console + JSONL session log.
const fs = require('fs')
const path = require('path')
const {
  parseDiagnosticsConfig,
  sanitizeValue,
  summarizePool,
  summarizeTab,
  summarizeView
} = require('./diagnostics')

function createMainDiagnostics(options = {}) {
  const rootDir = options.rootDir || process.cwd()
  const config = parseDiagnosticsConfig(options.env || process.env)
  const sessionId = config.sessionId || new Date().toISOString().replace(/[:.]/g, '-')
  const logDir = path.join(rootDir, '.cache', 'diagnostics')
  const logPath = path.join(logDir, `session-${sessionId}.jsonl`)
  const reportPath = path.join(logDir, `report-${sessionId}.json`)

  const startedAt = Date.now()
  const countsByChannel = Object.create(null)
  const countsByEvent = Object.create(null)
  const recentErrors = []
  let lastPoolSnapshot = null
  let peakPoolUsage = null
  let writeChain = Promise.resolve()
  let seq = 0

  function trackPeakPool(snapshot) {
    if (!snapshot) return
    const score = (pool) => (
      (pool.web?.total || 0) +
      (pool.canvas?.total || 0) +
      (pool.web?.backup || 0) +
      (pool.canvas?.backup || 0)
    )
    if (!peakPoolUsage || score(snapshot) > score(peakPoolUsage)) {
      peakPoolUsage = snapshot
    }
  }

  function isEnabled(channel) {
    return config.enabled && config.channels.has(channel)
  }

  function writeFileLine(entry) {
    if (!config.fileEnabled) return
    writeChain = writeChain.then(async () => {
      await fs.promises.mkdir(logDir, { recursive: true })
      await fs.promises.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
    }).catch(error => {
      console.error('[nucleus:diagnostics] Unable to write log line:', error)
    })
  }

  function log(channel, event, data = {}, meta = {}) {
    if (!isEnabled(channel)) return null
    const entry = {
      seq: ++seq,
      ts: new Date().toISOString(),
      tMs: Date.now() - startedAt,
      process: 'main',
      channel,
      event,
      data: sanitizeValue(data),
      ...sanitizeValue(meta)
    }

    countsByChannel[channel] = (countsByChannel[channel] || 0) + 1
    const eventKey = `${channel}:${event}`
    countsByEvent[eventKey] = (countsByEvent[eventKey] || 0) + 1

    if (channel === 'error') {
      recentErrors.push(entry)
      if (recentErrors.length > 40) recentErrors.shift()
    }

    if (config.consoleEnabled) {
      console.log(`[nucleus:${channel}] ${event}`, entry.data || {})
    }
    writeFileLine(entry)
    return entry
  }

  function logPool(event, browserpool, extra = {}) {
    const pool = summarizePool(browserpool)
    lastPoolSnapshot = pool
    trackPeakPool(pool)
    log('pool', event, { pool, ...extra })
    return pool
  }

  function logTab(event, tab, extra = {}) {
    log('tabs', event, { tab: summarizeTab(tab), ...extra })
  }

  function logView(event, view, tab = null, extra = {}) {
    log('layout', event, {
      view: summarizeView(view),
      tab: summarizeTab(tab),
      ...extra
    })
  }

  function logIpc(direction, name, extra = {}) {
    log('ipc', `${direction}:${name}`, extra)
  }

  function logLifecycle(event, extra = {}) {
    log('lifecycle', event, extra)
  }

  function logError(event, error, extra = {}) {
    log('error', event, {
      error: sanitizeValue(error),
      ...extra
    })
  }

  function attachIpc(ipcMain) {
    if (!ipcMain) return
    ipcMain.on('diagnostics:log', (_event, payload = {}) => {
      if (!config.enabled) return
      const channel = String(payload.channel || 'render')
      if (!config.channels.has(channel)) return
      const entry = {
        seq: ++seq,
        ts: new Date().toISOString(),
        tMs: Date.now() - startedAt,
        process: 'renderer',
        channel,
        event: String(payload.event || 'event'),
        data: sanitizeValue(payload.data || {}),
        meta: sanitizeValue(payload.meta || {})
      }
      countsByChannel[channel] = (countsByChannel[channel] || 0) + 1
      const eventKey = `${channel}:${entry.event}`
      countsByEvent[eventKey] = (countsByEvent[eventKey] || 0) + 1
      if (channel === 'error') {
        recentErrors.push(entry)
        if (recentErrors.length > 40) recentErrors.shift()
      }
      if (config.consoleEnabled) {
        console.log(`[nucleus:${channel}] ${entry.event}`, entry.data || {})
      }
      writeFileLine(entry)
    })

    ipcMain.handle('diagnostics:get_config', () => ({
      enabled: config.enabled,
      channels: [...config.channels],
      consoleEnabled: config.consoleEnabled,
      fileEnabled: config.fileEnabled,
      sessionId,
      logPath: config.fileEnabled ? logPath : '',
      reportPath: config.fileEnabled ? reportPath : ''
    }))
  }

  async function writeReport(reason = 'shutdown') {
    if (!config.enabled) return null
    await writeChain
    const report = {
      sessionId,
      reason,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      channels: [...config.channels],
      logPath: config.fileEnabled ? logPath : '',
      countsByChannel,
      countsByEvent,
      lastPoolSnapshot,
      peakPoolUsage,
      recentErrors: recentErrors.slice(-20)
    }
    if (config.fileEnabled) {
      await fs.promises.mkdir(logDir, { recursive: true })
      await fs.promises.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }
    if (config.consoleEnabled) {
      console.log('[nucleus:lifecycle] diagnostics_report', {
        reportPath: config.fileEnabled ? reportPath : '',
        countsByChannel,
        durationMs: report.durationMs
      })
    }
    return report
  }

  function attachApp(app) {
    if (!app || !config.enabled) return
    logLifecycle('diagnostics_enabled', {
      sessionId,
      channels: [...config.channels],
      logPath: config.fileEnabled ? logPath : ''
    })
    app.on('before-quit', () => {
      writeReport('before-quit').catch(error => {
        console.error('[nucleus:diagnostics] Unable to write report:', error)
      })
    })
  }

  return {
    config,
    sessionId,
    logPath,
    reportPath,
    isEnabled,
    log,
    logPool,
    logTab,
    logView,
    logIpc,
    logLifecycle,
    logError,
    attachIpc,
    attachApp,
    writeReport,
    summarizePool
  }
}

module.exports = {
  createMainDiagnostics
}
