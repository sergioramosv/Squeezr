/**
 * Squeezr real-time web dashboard.
 *
 * Served at GET /squeezr/dashboard
 * Live data via SSE at GET /squeezr/events (pushes every 2s)
 * Mode control via POST /squeezr/config
 */

export const DASHBOARD_HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Squeezr Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --bg:#0d1117;--bg2:#161b22;--bg3:#21262d;--border:#30363d;
    --text:#e6edf3;--muted:#8b949e;--green:#3fb950;--yellow:#d29922;
    --red:#f85149;--blue:#58a6ff;--purple:#bc8cff;--orange:#ffa657;
    --accent:#238636
  }
  html,body{height:100%;background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5}
  a{color:var(--blue);text-decoration:none}

  /* ── Layout ── */
  #app{display:flex;flex-direction:column;height:100vh;overflow:hidden}
  #header{display:flex;align-items:center;gap:12px;padding:12px 20px;background:var(--bg2);border-bottom:1px solid var(--border);flex-shrink:0}
  #header h1{font-size:16px;font-weight:600;letter-spacing:.5px}
  #header h1 span{color:var(--blue)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);flex-shrink:0}
  .dot.off{background:var(--red);box-shadow:0 0 6px var(--red)}
  #uptime{font-size:12px;color:var(--muted);margin-left:auto}
  #port-badge{font-size:11px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:2px 8px;color:var(--muted)}

  #main{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:16px}

  /* ── Metric cards ── */
  #cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
  .card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:16px}
  .card-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .card-value{font-size:28px;font-weight:700;line-height:1.1}
  .card-sub{font-size:12px;color:var(--muted);margin-top:4px}
  .card.green .card-value{color:var(--green)}
  .card.blue .card-value{color:var(--blue)}
  .card.yellow .card-value{color:var(--yellow)}
  .card.orange .card-value{color:var(--orange)}

  /* ── Pressure bar ── */
  #pressure-wrap{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
  #pressure-wrap h3{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
  .bar-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .bar-label{font-size:12px;color:var(--muted);width:110px;flex-shrink:0}
  .bar-track{flex:1;height:8px;background:var(--bg3);border-radius:4px;overflow:hidden}
  .bar-fill{height:100%;border-radius:4px;transition:width .4s ease,background .4s}
  .bar-pct{font-size:12px;width:38px;text-align:right;flex-shrink:0}

  /* ── Sparkline ── */
  #chart-wrap{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
  #chart-wrap h3{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
  #chart-wrap .legend{font-size:11px;color:var(--muted);margin-bottom:6px}
  canvas#sparkline{width:100%;height:80px;display:block}

  /* ── Mode selector ── */
  #mode-wrap{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
  #mode-wrap h3{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
  #mode-btns{display:flex;gap:8px;flex-wrap:wrap}
  .mode-btn{padding:6px 16px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text);cursor:pointer;font-size:13px;transition:all .15s}
  .mode-btn:hover{border-color:var(--blue);color:var(--blue)}
  .mode-btn.active{border-color:var(--accent);background:var(--accent);color:#fff}
  #mode-desc{font-size:12px;color:var(--muted);margin-top:8px;min-height:18px}

  /* ── Tool table ── */
  #tools-wrap{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
  #tools-wrap h3{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
  table{width:100%;border-collapse:collapse}
  th{font-size:11px;color:var(--muted);text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)}
  td{padding:6px 8px;font-size:13px;border-bottom:1px solid var(--border)}
  tr:last-child td{border-bottom:none}
  .td-right{text-align:right;font-variant-numeric:tabular-nums}
  .mini-bar{display:inline-block;height:6px;background:var(--green);border-radius:3px;vertical-align:middle;margin-right:6px;opacity:.75}

  /* ── Cache row ── */
  #cache-row{display:flex;gap:12px}
  .cache-card{flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px 16px}
  .cache-card .card-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
  .cache-card .card-value{font-size:20px;font-weight:600;color:var(--purple)}

  /* ── Footer ── */
  #footer{padding:8px 20px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);display:flex;gap:16px;flex-shrink:0}
  #conn-status{margin-left:auto}
  #conn-status.ok{color:var(--green)}
  #conn-status.err{color:var(--red)}
</style>
</head>
<body>
<div id="app">

  <!-- Header -->
  <div id="header">
    <div class="dot" id="status-dot"></div>
    <h1>Squee<span>zr</span></h1>
    <span id="port-badge">:PORT</span>
    <span id="uptime">starting…</span>
  </div>

  <div id="main">

    <!-- Metric cards -->
    <div id="cards">
      <div class="card green">
        <div class="card-label">Tokens Saved</div>
        <div class="card-value" id="c-tokens">—</div>
        <div class="card-sub" id="c-chars">— chars</div>
      </div>
      <div class="card blue">
        <div class="card-label">Compression</div>
        <div class="card-value" id="c-pct">—</div>
        <div class="card-sub" id="c-sub-pct">tool results</div>
      </div>
      <div class="card yellow">
        <div class="card-label">Requests</div>
        <div class="card-value" id="c-req">—</div>
        <div class="card-sub" id="c-compressions">— compressions</div>
      </div>
      <div class="card orange">
        <div class="card-label">Est. Cost Saved</div>
        <div class="card-value" id="c-cost">—</div>
        <div class="card-sub">@ $3 / MTok</div>
      </div>
    </div>

    <!-- Pressure bars -->
    <div id="pressure-wrap">
      <h3>Context pressure (last request)</h3>
      <div class="bar-row">
        <span class="bar-label">Messages</span>
        <div class="bar-track"><div class="bar-fill" id="bar-msg" style="width:0%"></div></div>
        <span class="bar-pct" id="pct-msg">0%</span>
      </div>
      <div class="bar-row">
        <span class="bar-label">After compression</span>
        <div class="bar-track"><div class="bar-fill" id="bar-out" style="width:0%"></div></div>
        <span class="bar-pct" id="pct-out">0%</span>
      </div>
      <div class="bar-row" style="margin-bottom:0">
        <span class="bar-label">Session cache hits</span>
        <div class="bar-track"><div class="bar-fill" id="bar-cache" style="width:0%;background:var(--purple)"></div></div>
        <span class="bar-pct" id="pct-cache">0</span>
      </div>
    </div>

    <!-- Sparkline -->
    <div id="chart-wrap">
      <h3>Activity — tokens saved per request <span class="legend">(last 60 requests)</span></h3>
      <canvas id="sparkline"></canvas>
    </div>

    <!-- Compression mode -->
    <div id="mode-wrap">
      <h3>Compression mode</h3>
      <div id="mode-btns">
        <button class="mode-btn" data-mode="soft">🐢 Soft</button>
        <button class="mode-btn active" data-mode="normal">⚖️ Normal</button>
        <button class="mode-btn" data-mode="aggressive">🔥 Aggressive</button>
        <button class="mode-btn" data-mode="critical">🚨 Critical</button>
      </div>
      <div id="mode-desc">Normal — threshold 800 chars, last 3 results uncompressed</div>
    </div>

    <!-- Tool breakdown -->
    <div id="tools-wrap">
      <h3>By tool</h3>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th class="td-right">Calls</th>
            <th class="td-right">Tokens saved</th>
            <th>Savings</th>
          </tr>
        </thead>
        <tbody id="tools-body">
          <tr><td colspan="4" style="color:var(--muted);padding:16px 8px">No data yet…</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Cache stats -->
    <div id="cache-row">
      <div class="cache-card">
        <div class="card-label">Session cache entries</div>
        <div class="card-value" id="c-scache">—</div>
      </div>
      <div class="cache-card">
        <div class="card-label">Expand store entries</div>
        <div class="card-value" id="c-expand">—</div>
      </div>
      <div class="cache-card">
        <div class="card-label">LRU cache entries</div>
        <div class="card-value" id="c-lru">—</div>
      </div>
      <div class="cache-card">
        <div class="card-label">Pattern hits</div>
        <div class="card-value" id="c-patterns">—</div>
      </div>
    </div>

  </div><!-- /main -->

  <div id="footer">
    <span>Squeezr v<span id="f-version">—</span></span>
    <span id="f-mode">mode: active</span>
    <span>dashboard: <a href="/squeezr/stats" target="_blank">/squeezr/stats</a></span>
    <span id="conn-status" class="ok">● connected</span>
  </div>

</div><!-- /app -->

<script>
// ── Sparkline data ───────────────────────────────────────────────────────────
const MAX_POINTS = 60
const sparkData = []
let lastSavedTokens = 0

function pushSparkPoint(savedTokens) {
  const delta = Math.max(0, savedTokens - lastSavedTokens)
  lastSavedTokens = savedTokens
  sparkData.push(delta)
  if (sparkData.length > MAX_POINTS) sparkData.shift()
}

function drawSparkline() {
  const canvas = document.getElementById('sparkline')
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  const w = rect.width, h = rect.height
  const max = Math.max(...sparkData, 1)
  ctx.clearRect(0, 0, w, h)
  if (sparkData.length < 2) return
  const step = w / (MAX_POINTS - 1)

  // Fill
  ctx.beginPath()
  ctx.moveTo(0, h)
  sparkData.forEach((v, i) => {
    const x = i * step
    const y = h - (v / max) * (h - 4)
    i === 0 ? ctx.lineTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.lineTo((sparkData.length - 1) * step, h)
  ctx.closePath()
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, 'rgba(63,185,80,.35)')
  grad.addColorStop(1, 'rgba(63,185,80,0)')
  ctx.fillStyle = grad
  ctx.fill()

  // Line
  ctx.beginPath()
  sparkData.forEach((v, i) => {
    const x = i * step
    const y = h - (v / max) * (h - 4)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.strokeStyle = '#3fb950'
  ctx.lineWidth = 1.5
  ctx.stroke()
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}
function fmtCost(tokens) {
  const usd = (tokens / 1e6) * 3
  if (usd < 0.01) return '<$0.01'
  if (usd < 1) return '$' + usd.toFixed(2)
  return '$' + usd.toFixed(1)
}
function fmtUptime(s) {
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's'
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm'
}
function barColor(pct) {
  if (pct >= 90) return 'var(--red)'
  if (pct >= 75) return 'var(--yellow)'
  if (pct >= 50) return 'var(--orange)'
  return 'var(--blue)'
}

// ── Render stats ─────────────────────────────────────────────────────────────
function render(d) {
  // Cards
  document.getElementById('c-tokens').textContent = fmtNum(d.total_saved_tokens)
  document.getElementById('c-chars').textContent = d.total_saved_chars.toLocaleString() + ' chars'
  document.getElementById('c-pct').textContent = d.savings_pct + '%'
  document.getElementById('c-req').textContent = fmtNum(d.requests)
  document.getElementById('c-compressions').textContent = d.compressions + ' compressions'
  document.getElementById('c-cost').textContent = fmtCost(d.total_saved_tokens)
  document.getElementById('f-version').textContent = d.version || '—'
  document.getElementById('f-mode').textContent = 'mode: ' + (d.dry_run ? 'dry-run' : 'active')

  // Uptime
  document.getElementById('uptime').textContent = 'uptime ' + fmtUptime(d.uptime_seconds)

  // Pressure bars
  const msgPct = Math.round((d.last_original_chars || 0) / 8000)
  const outPct = Math.round((d.last_compressed_chars || 0) / 8000)
  const cacheHits = d.session_cache_hits || 0
  const cacheMax = Math.max(d.compressions, 1)
  const cachePct = Math.round((cacheHits / (cacheHits + cacheMax)) * 100)

  setBar('bar-msg', 'pct-msg', Math.min(msgPct, 100), msgPct + '%')
  setBar('bar-out', 'pct-out', Math.min(outPct, 100), outPct + '%')
  setBar('bar-cache', 'pct-cache', Math.min(cachePct, 100), cacheHits, true)

  // Sparkline
  pushSparkPoint(d.total_saved_tokens)
  drawSparkline()

  // Tools table
  const byTool = d.by_tool || {}
  const rows = Object.entries(byTool).sort((a,b) => b[1].saved_tokens - a[1].saved_tokens)
  const maxSaved = rows[0]?.[1]?.saved_tokens || 1
  const tbody = document.getElementById('tools-body')
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);padding:16px 8px">No tool results compressed yet…</td></tr>'
  } else {
    tbody.innerHTML = rows.map(([tool, t]) => {
      const barW = Math.round((t.saved_tokens / maxSaved) * 80)
      return \`<tr>
        <td><code style="background:var(--bg3);padding:1px 6px;border-radius:3px;font-size:12px">\${tool}</code></td>
        <td class="td-right" style="color:var(--muted)">\${t.count}</td>
        <td class="td-right">\${fmtNum(t.saved_tokens)}</td>
        <td><span class="mini-bar" style="width:\${barW}px"></span>\${t.avg_pct}%</td>
      </tr>\`
    }).join('')
  }

  // Cache stats
  document.getElementById('c-scache').textContent = d.session_cache_size ?? '—'
  document.getElementById('c-expand').textContent = d.expand_store_size ?? '—'
  document.getElementById('c-lru').textContent = d.cache?.size ?? '—'
  document.getElementById('c-patterns').textContent = d.pattern_hits
    ? Object.values(d.pattern_hits).reduce((s, v) => s + v, 0).toLocaleString()
    : '—'
}

function setBar(barId, pctId, pct, label, noColor) {
  const bar = document.getElementById(barId)
  const pctEl = document.getElementById(pctId)
  bar.style.width = pct + '%'
  if (!noColor) bar.style.background = barColor(pct)
  pctEl.textContent = label
}

// ── Mode selector ────────────────────────────────────────────────────────────
const modeDescriptions = {
  soft:       'Soft — threshold 3000 chars, last 10 results uncompressed, no AI',
  normal:     'Normal — threshold 800 chars, last 3 results uncompressed',
  aggressive: 'Aggressive — threshold 200 chars, last 1 result uncompressed',
  critical:   'Critical — threshold 50 chars, all results compressed, max AI'
}

document.getElementById('mode-btns').addEventListener('click', async (e) => {
  const btn = e.target.closest('.mode-btn')
  if (!btn) return
  const mode = btn.dataset.mode
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  document.getElementById('mode-desc').textContent = modeDescriptions[mode] || ''
  try {
    await fetch('/squeezr/config', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ mode })
    })
  } catch(e) { console.error('config update failed', e) }
})

// ── SSE connection ────────────────────────────────────────────────────────────
const dot = document.getElementById('status-dot')
const connStatus = document.getElementById('conn-status')
const portBadge = document.getElementById('port-badge')

function connect() {
  const es = new EventSource('/squeezr/events')
  es.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data)
      render(d)
      if (d.port) portBadge.textContent = ':' + d.port
      if (d.mode) {
        document.querySelectorAll('.mode-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.mode === d.mode)
        })
        document.getElementById('mode-desc').textContent = modeDescriptions[d.mode] || ''
      }
    } catch(err) { console.error(err) }
  }
  es.onopen = () => {
    dot.classList.remove('off')
    connStatus.className = 'ok'
    connStatus.textContent = '● connected'
  }
  es.onerror = () => {
    dot.classList.add('off')
    connStatus.className = 'err'
    connStatus.textContent = '● reconnecting…'
    es.close()
    setTimeout(connect, 3000)
  }
}

connect()

// ── Resize sparkline on window resize ────────────────────────────────────────
window.addEventListener('resize', drawSparkline)
</script>
</body>
</html>`
