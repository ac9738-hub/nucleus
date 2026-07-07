// Local HTTP dashboard for resource governor + Canvas lag spike evaluation.
'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')

const DEFAULT_PORT = 8790

function jsonResponse(res, payload, status = 200) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  })
  res.end(body)
}

function htmlPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nucleus perf eval</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    body { margin: 0; background: #0b1018; color: #e6edf7; }
    header { padding: 16px 20px; border-bottom: 1px solid #243044; display: flex; justify-content: space-between; align-items: center; }
    h1 { margin: 0; font-size: 16px; color: #9ec5ff; }
    .sub { color: #8aa0c2; font-size: 11px; margin-top: 4px; }
    main { padding: 16px 20px 28px; display: grid; gap: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
    .card { background: #121926; border: 1px solid #243044; border-radius: 10px; padding: 12px; }
    .card .label { color: #8aa0c2; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
    .card .value { font-size: 22px; margin-top: 6px; font-weight: 700; }
    section h2 { font-size: 12px; color: #9ec5ff; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #1b2433; vertical-align: top; }
    th { color: #8aa0c2; font-weight: 600; }
    .bar-wrap { background: #1b2433; border-radius: 4px; height: 8px; overflow: hidden; }
    .bar { height: 100%; background: linear-gradient(90deg, #3d7eff, #79b8ff); }
    .warn { color: #ffb454; }
    .bad { color: #ff7b72; }
    .ok { color: #7ee787; }
    .plan { line-height: 1.5; font-size: 12px; color: #c9d6ea; }
    .plan li { margin: 6px 0; }
    code { color: #79b8ff; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Nucleus resource & lag eval</h1>
      <div class="sub">Canvas interaction spikes · governor · preload · Python procs</div>
    </div>
    <div class="sub" id="clock">—</div>
  </header>
  <main>
    <div class="grid" id="cards"></div>
    <section class="card">
      <h2>Top lag drivers (p95)</h2>
      <table id="ops-table"><thead><tr><th>Operation</th><th>Count</th><th>p50</th><th>p95</th><th>Max</th><th></th></tr></thead><tbody></tbody></table>
    </section>
    <section class="card">
      <h2>Recent spikes</h2>
      <table id="spikes-table"><thead><tr><th>When</th><th>Op</th><th>Ms</th><th>Over</th><th>Meta</th></tr></thead><tbody></tbody></table>
    </section>
    <section class="card">
      <h2>Resources</h2>
      <div id="resources" class="sub">Loading…</div>
    </section>
    <section class="card plan">
      <h2>Fix plan (from instrumentation)</h2>
      <ol id="fix-plan"></ol>
    </section>
  </main>
  <script>
    function fmtMs(v) { return v == null ? '—' : v.toFixed(1) + 'ms' }
    function clsMs(v, warn, bad) {
      if (v == null) return ''
      if (v >= bad) return 'bad'
      if (v >= warn) return 'warn'
      return 'ok'
    }
    function bar(max, value) {
      const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0
      return '<div class="bar-wrap"><div class="bar" style="width:' + pct + '%"></div></div>'
    }
    function render(data) {
      const lag = data.lag || {}
      const gov = data.governor || {}
      const preload = data.preload || {}
      const spikes = lag.spikes || {}
      const cards = [
        ['Spikes', spikes.totalSpikes ?? 0, ''],
        ['Nav spikes', spikes.navSpikeCount ?? 0, ''],
        ['Governor tier', gov.policy && gov.policy.tier || '—', ''],
        ['Mem used', gov.snapshot && gov.snapshot.system ? gov.snapshot.system.usedMemPct + '%' : '—', clsMs(gov.snapshot && gov.snapshot.system && gov.snapshot.system.usedMemPct, 85, 95)],
        ['Preload hit rate', preload.metrics && preload.metrics.hitRate != null ? (preload.metrics.hitRate * 100).toFixed(1) + '%' : '—', ''],
        ['Tab queue', spikes.serializedQueueDepth ?? 0, spikes.serializedQueueDepth > 0 ? 'warn' : 'ok']
      ]
      document.getElementById('cards').innerHTML = cards.map(([label, value, klass]) =>
        '<div class="card"><div class="label">' + label + '</div><div class="value ' + klass + '">' + value + '</div></div>'
      ).join('')

      const ops = lag.byOp || []
      const maxP95 = ops.reduce((m, r) => Math.max(m, r.p95Ms || 0), 0)
      document.querySelector('#ops-table tbody').innerHTML = ops.slice(0, 12).map(row =>
        '<tr><td>' + row.op + '</td><td>' + row.count + '</td><td>' + fmtMs(row.p50Ms) + '</td><td class="' + clsMs(row.p95Ms, 120, 250) + '">' + fmtMs(row.p95Ms) + '</td><td>' + fmtMs(row.maxMs) + '</td><td>' + bar(maxP95, row.p95Ms || 0) + '</td></tr>'
      ).join('') || '<tr><td colspan="6">No samples yet — interact with Canvas tabs.</td></tr>'

      const recent = spikes.recent || []
      document.querySelector('#spikes-table tbody').innerHTML = recent.map(row => {
        const meta = row.meta ? JSON.stringify(row.meta).slice(0, 120) : ''
        return '<tr><td>' + new Date(row.ts).toLocaleTimeString() + '</td><td>' + row.op + '</td><td class="bad">' + row.durationMs + 'ms</td><td>+' + row.overMs + 'ms</td><td>' + meta + '</td></tr>'
      }).join('') || '<tr><td colspan="5">No spikes recorded.</td></tr>'

      const res = data.resources || {}
      const el = res.electron || {}
      const sys = res.system || {}
      document.getElementById('resources').innerHTML = [
        'System: ' + (sys.usedMemPct != null ? sys.usedMemPct + '% used' : '—') + ' · ' + (sys.freeMemMb != null ? sys.freeMemMb + 'MB free' : ''),
        'Electron WS: ' + (el.totalWorkingSetMb != null ? el.totalWorkingSetMb + 'MB' : '—') + ' · procs ' + (el.processCount || 0),
        'Python procs: ' + (data.pythonProcessCount ?? '—'),
        'Preload slots active: ' + (preload.slots ? preload.slots.filter(s => s.url).length : '—') + ' / ' + (preload.predictiveSlotCount || 2),
        'Parser: ' + ((gov.policy && gov.policy.pauseParser) ? 'paused' : 'ok') + ' · Preload: ' + ((gov.policy && gov.policy.pausePreload) ? 'paused' : 'ok') + ' · Sidekick: ' + ((gov.policy && gov.policy.pauseSidekick) ? 'paused' : 'ok')
      ].map(line => '<div>' + line + '</div>').join('')

      document.getElementById('fix-plan').innerHTML = (data.fixPlan || []).map(item => '<li>' + item + '</li>').join('')
      document.getElementById('clock').textContent = 'Updated ' + new Date(data.sampledAt || Date.now()).toLocaleTimeString()
    }

    async function tick() {
      try {
        const res = await fetch('/api/snapshot')
        render(await res.json())
      } catch (error) {
        document.getElementById('resources').textContent = 'Unable to reach eval server: ' + error
      }
    }
    tick()
    setInterval(tick, 1000)
  </script>
</body>
</html>`
}

function buildFixPlan(snapshot) {
  const plan = []
  const byOp = snapshot.lag && snapshot.lag.byOp ? snapshot.lag.byOp : []
  const top = byOp[0]
  const spikes = snapshot.lag && snapshot.lag.spikes ? snapshot.lag.spikes : {}

  if (top && top.op === 'visible_context.update' && top.p95Ms >= 120) {
    plan.push('Defer <code>visible_context.update</code> during nav: skip full DOM scroll scan for 300ms after <code>canvas.open_link</code> / tab switch (biggest main-thread win).')
  }
  if (byOp.some(row => row.op === 'preload.refresh' && row.p95Ms >= 200)) {
    plan.push('Debounce <code>preload.refresh</code> harder while <code>tabNavigating</code> or governor interactive tier is active; avoid loading 2 hidden Canvas views immediately after every click.')
  }
  if (byOp.some(row => row.op === 'nav.wait_reveal' && row.p95Ms >= 300)) {
    plan.push('Tune slate transition: reduce <code>waitForReveal</code> paint gate / first_paint timeout; allow fast-path reveal when preload swap already READY.')
  }
  if (byOp.some(row => row.op === 'tab.run_serialized_wait' && (row.p95Ms >= 80 || spikes.serializedQueueDepth > 0))) {
    plan.push('Split <code>runSerializedTabOperation</code>: allow read-only IPC (stats, scroll context pull) to bypass the nav queue so rapid clicks do not stack wait time.')
  }
  if (byOp.some(row => row.op === 'preload.extract_links' && row.p95Ms >= 100)) {
    plan.push('Cache DOM link extraction per URL generation; skip <code>executeJavaScript</code> extract when pointer hints arrived within TTL.')
  }
  if (snapshot.governor && snapshot.governor.policy && snapshot.governor.policy.pausePreload) {
    plan.push('Memory governor is pausing preload — expect more cold navigations; fix memory throttling or raise preload priority after nav completes.')
  }
  if (!plan.length) {
    plan.push('Interact with Canvas (open links, switch tabs, scroll) to populate spike data. Baseline suspects: slate reveal, serialized tab queue, visible-context DOM scan, post-nav preload refresh.')
  }
  return plan
}

function countPythonProcesses(app) {
  if (!app || typeof app.getAppMetrics !== 'function') return 0
  try {
    return app.getAppMetrics().filter(entry => {
      const type = String(entry.type || '').toLowerCase()
      return type.includes('python') || type === 'utility'
    }).length
  } catch (_error) {
    return 0
  }
}

function createPerfEvalServer(options = {}) {
  const port = Number(options.port) || Number(process.env.NUCLEUS_PERF_SERVER_PORT) || DEFAULT_PORT
  const getSnapshot = typeof options.getSnapshot === 'function' ? options.getSnapshot : () => ({})
  const cacheDir = options.cacheDir || path.join(process.cwd(), '.cache', 'perf_eval')
  let server = null

  function buildPayload() {
    const payload = getSnapshot()
    payload.fixPlan = buildFixPlan(payload)
    payload.sampledAt = Date.now()
    return payload
  }

  function writeCache(payload) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.writeFileSync(path.join(cacheDir, 'snapshot.json'), JSON.stringify(payload, null, 2))
    } catch (_error) {
      // ignore
    }
  }

  function start() {
    if (server) return { ok: true, port, url: `http://127.0.0.1:${port}/` }

    server = http.createServer((req, res) => {
      const url = req.url || '/'
      if (url === '/' || url.startsWith('/index')) {
        const html = htmlPage()
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
        return
      }
      if (url.startsWith('/api/snapshot')) {
        const payload = buildPayload()
        writeCache(payload)
        jsonResponse(res, payload)
        return
      }
      if (url.startsWith('/api/health')) {
        jsonResponse(res, { ok: true, port })
        return
      }
      jsonResponse(res, { ok: false, error: 'not_found' }, 404)
    })

    const basePort = port
    const maxAttempts = Number(process.env.NUCLEUS_PERF_SERVER_PORT_ATTEMPTS || 10)

    return new Promise((resolve) => {
      let attempt = 0

      function tryListen(nextPort) {
        attempt += 1
        port = nextPort
        server.removeAllListeners('error')
        server.once('error', error => {
          if (error && error.code === 'EADDRINUSE' && attempt < maxAttempts) {
            console.warn(`[nucleus:perf] port ${nextPort} in use, trying ${nextPort + 1}`)
            tryListen(nextPort + 1)
            return
          }
          console.error('[nucleus:perf] eval server failed to start:', error && error.message ? error.message : error)
          server = null
          resolve({ ok: false, port: nextPort, error: error && error.code ? error.code : 'listen_failed' })
        })
        server.listen(nextPort, '127.0.0.1', () => {
          const url = `http://127.0.0.1:${nextPort}/`
          if (nextPort !== basePort) {
            console.warn(`[nucleus:perf] default port ${basePort} busy; using ${nextPort}`)
          }
          console.log(`[nucleus:perf] eval UI ${url}`)
          resolve({ ok: true, port: nextPort, url })
        })
      }

      tryListen(basePort)
    })
  }

  function stop() {
    if (!server) return false
    server.close()
    server = null
    return true
  }

  return { start, stop, buildPayload, port }
}

module.exports = {
  createPerfEvalServer,
  buildFixPlan,
  DEFAULT_PORT
}
