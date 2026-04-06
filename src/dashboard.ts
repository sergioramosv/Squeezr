/**
 * Squeezr Dashboard — single-file SPA
 * Dark GitHub-style theme, sidebar navigation, 4 pages.
 * All data via SSE (/squeezr/events) + REST (/squeezr/history, /squeezr/projects).
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
  --bg:#0d1117;--bg2:#161b22;--bg3:#21262d;--bg4:#2d333b;
  --border:#30363d;--text:#e6edf3;--muted:#8b949e;
  --green:#3fb950;--yellow:#d29922;--red:#f85149;
  --blue:#58a6ff;--purple:#bc8cff;--orange:#ffa657;--accent:#238636
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.5}
a{color:var(--blue);text-decoration:none}
code{font-family:'Cascadia Code','Fira Mono','Consolas',monospace}

/* ── App shell ── */
#app{display:flex;height:100vh;overflow:hidden}

/* ── Sidebar ── */
#sidebar{
  width:200px;flex-shrink:0;background:var(--bg2);
  border-right:1px solid var(--border);
  display:flex;flex-direction:column;overflow:hidden
}
#sidebar-brand{padding:16px 16px 12px;border-bottom:1px solid var(--border)}
#sidebar-brand .logo{font-size:18px;font-weight:700;letter-spacing:.3px;line-height:1}
#sidebar-brand .logo span{color:var(--blue)}
#sidebar-brand .ver{font-size:11px;color:var(--muted);margin-top:3px}

nav{flex:1;padding:8px 0;overflow-y:auto}
.nav-item{
  display:flex;align-items:center;gap:9px;padding:8px 16px;
  color:var(--muted);cursor:pointer;border-radius:0;
  transition:background .1s,color .1s;user-select:none
}
.nav-item:hover{background:var(--bg3);color:var(--text)}
.nav-item.active{background:var(--bg3);color:var(--blue)}
.nav-item svg{flex-shrink:0;opacity:.8}
.nav-item.active svg{opacity:1}
.nav-label{font-size:13px}

#sidebar-footer{padding:12px 16px;border-top:1px solid var(--border)}
.status-row{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--muted)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 5px var(--green);flex-shrink:0}
.dot.off{background:var(--red);box-shadow:0 0 5px var(--red)}
#uptime-small{font-size:11px;color:var(--muted);margin-top:4px}

/* ── Main content ── */
#content{flex:1;display:flex;flex-direction:column;overflow:hidden}
#page-header{
  display:flex;align-items:center;gap:10px;padding:12px 20px;
  background:var(--bg2);border-bottom:1px solid var(--border);flex-shrink:0
}
#page-title{font-size:15px;font-weight:600}
#project-badge{
  font-size:11px;background:var(--bg3);border:1px solid var(--border);
  border-radius:12px;padding:2px 10px;color:var(--blue);font-weight:500
}
#header-uptime{font-size:11px;color:var(--muted);margin-left:auto}
#conn-pill{
  font-size:11px;padding:2px 8px;border-radius:10px;
  background:rgba(63,185,80,.15);color:var(--green);border:1px solid rgba(63,185,80,.3)
}
#conn-pill.err{background:rgba(248,81,73,.15);color:var(--red);border-color:rgba(248,81,73,.3)}

#pages{flex:1;overflow-y:auto;padding:16px 20px}
.page{display:none}
.page.active{display:block}

/* ── Cards ── */
.cards-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:10px;margin-bottom:14px}
.card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
.card-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.card-value{font-size:26px;font-weight:700;line-height:1.1}
.card-sub{font-size:11px;color:var(--muted);margin-top:3px}
.c-green .card-value{color:var(--green)}
.c-blue .card-value{color:var(--blue)}
.c-yellow .card-value{color:var(--yellow)}
.c-orange .card-value{color:var(--orange)}

/* ── Sections ── */
.section{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:14px}
.section-title{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;font-weight:600}

/* ── Bars ── */
.bar-row{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.bar-label{font-size:12px;color:var(--muted);width:130px;flex-shrink:0}
.bar-track{flex:1;height:7px;background:var(--bg3);border-radius:4px;overflow:hidden}
.bar-fill{height:100%;border-radius:4px;transition:width .4s,background .4s}
.bar-val{font-size:11px;width:36px;text-align:right;flex-shrink:0;color:var(--muted)}

/* ── Sparkline ── */
canvas#sparkline{width:100%;height:72px;display:block}

/* ── Tables ── */
table{width:100%;border-collapse:collapse}
th{font-size:11px;color:var(--muted);text-align:left;padding:4px 8px;border-bottom:1px solid var(--border);font-weight:500;letter-spacing:.3px;text-transform:uppercase}
td{padding:6px 8px;font-size:12px;border-bottom:1px solid var(--border)}
tr:last-child td{border-bottom:none}
.td-right{text-align:right;font-variant-numeric:tabular-nums}
.mini-bar{display:inline-block;height:5px;border-radius:2px;vertical-align:middle;margin-right:5px;opacity:.75}
.tag{display:inline-block;background:var(--bg3);border:1px solid var(--border);border-radius:3px;padding:1px 6px;font-size:11px;font-family:monospace}

/* ── Cache row ── */
.cache-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.cache-card{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px}
.cache-card .cache-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
.cache-card .cache-val{font-size:18px;font-weight:600;color:var(--purple)}

/* ── Mode buttons ── */
.mode-btns{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.mode-btn{
  display:flex;align-items:center;gap:6px;padding:6px 14px;
  border-radius:6px;border:1px solid var(--border);background:var(--bg3);
  color:var(--muted);cursor:pointer;font-size:12px;transition:all .15s
}
.mode-btn:hover{border-color:var(--blue);color:var(--text)}
.mode-btn.active{border-color:var(--accent);background:var(--accent);color:#fff}
.mode-btn.active svg{stroke:white}
#mode-desc{font-size:12px;color:var(--muted);min-height:16px}

/* ── Projects page ── */
.project-table td:first-child code{font-size:12px}
.project-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}

/* ── History page ── */
#hist-layout{display:grid;grid-template-columns:220px 1fr;gap:12px;min-height:400px}
#hist-projects{background:var(--bg2);border:1px solid var(--border);border-radius:8px;overflow:hidden}
#hist-sessions{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:0}
.hist-proj-item{
  padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border);
  display:flex;justify-content:space-between;align-items:center;
  font-size:12px;color:var(--muted);transition:background .1s
}
.hist-proj-item:last-child{border-bottom:none}
.hist-proj-item:hover{background:var(--bg3)}
.hist-proj-item.active{background:var(--bg3);color:var(--blue)}
.hist-proj-count{font-size:11px;background:var(--bg4);border-radius:10px;padding:1px 7px}
.hist-sessions-header{padding:12px 16px;border-bottom:1px solid var(--border);font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.session-card{padding:12px 16px;border-bottom:1px solid var(--border)}
.session-card:last-child{border-bottom:none}
.session-date{font-size:12px;font-weight:600;color:var(--text);margin-bottom:4px}
.session-time{font-size:11px;color:var(--muted);margin-bottom:6px}
.session-stats{display:flex;gap:14px;flex-wrap:wrap}
.session-stat{font-size:11px;color:var(--muted)}
.session-stat span{color:var(--text);font-weight:500}
.session-project-badge{font-size:10px;background:var(--bg4);border:1px solid var(--border);border-radius:10px;padding:1px 8px;color:var(--blue);margin-left:6px}
.empty-msg{padding:32px 16px;text-align:center;color:var(--muted);font-size:12px}

/* ── Settings ── */
.config-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px}
.config-row:last-child{border-bottom:none}
.config-key{color:var(--muted)}
.config-val{font-family:monospace;color:var(--text)}

/* ── Footer bar ── */
#footer{padding:7px 20px;border-top:1px solid var(--border);background:var(--bg2);font-size:11px;color:var(--muted);display:flex;gap:16px;flex-shrink:0}
#footer a{color:var(--muted)}#footer a:hover{color:var(--blue)}
</style>
</head>
<body>
<div id="app">

<!-- ── Sidebar ─────────────────────────────────────────────────────────────── -->
<div id="sidebar">
  <div id="sidebar-brand">
    <div class="logo">Squee<span>zr</span></div>
    <div class="ver" id="sb-ver">v—</div>
  </div>

  <nav>
    <div class="nav-item active" data-page="overview">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1 2.5A1.5 1.5 0 012.5 1h3A1.5 1.5 0 017 2.5v3A1.5 1.5 0 015.5 7h-3A1.5 1.5 0 011 5.5v-3zm8 0A1.5 1.5 0 0110.5 1h3A1.5 1.5 0 0115 2.5v3A1.5 1.5 0 0113.5 7h-3A1.5 1.5 0 019 5.5v-3zm-8 8A1.5 1.5 0 012.5 9h3A1.5 1.5 0 017 10.5v3A1.5 1.5 0 015.5 15h-3A1.5 1.5 0 011 13.5v-3zm8 0A1.5 1.5 0 0110.5 9h3a1.5 1.5 0 011.5 1.5v3A1.5 1.5 0 0113.5 15h-3A1.5 1.5 0 019 13.5v-3z"/>
      </svg>
      <span class="nav-label">Overview</span>
    </div>
    <div class="nav-item" data-page="projects">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
        <path d="M9.828 3h3.982a2 2 0 011.992 2.181l-.637 7A2 2 0 0113.174 14H2.826a2 2 0 01-1.991-1.819l-.637-7a1.99 1.99 0 01.342-1.31L.5 3a2 2 0 012-2h3.672a2 2 0 011.414.586l.828.828A2 2 0 009.828 3zm-8.322.12C1.72 3.042 1.95 3 2.19 3h5.396l-.707-.707A1 1 0 006.172 2H2.5a1 1 0 00-1 .981l.006.139z"/>
      </svg>
      <span class="nav-label">Projects</span>
    </div>
    <div class="nav-item" data-page="history">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 3.5a.5.5 0 00-1 0V9a.5.5 0 00.252.434l3.5 2a.5.5 0 00.496-.868L8 8.71V3.5z"/>
        <path d="M8 16A8 8 0 108 0a8 8 0 000 16zm7-8A7 7 0 111 8a7 7 0 0114 0z"/>
      </svg>
      <span class="nav-label">History</span>
    </div>
    <div class="nav-item" data-page="settings">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 4.754a3.246 3.246 0 100 6.492 3.246 3.246 0 000-6.492zM5.754 8a2.246 2.246 0 114.492 0 2.246 2.246 0 01-4.492 0z"/>
        <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 01-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 01-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 01.52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 011.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 011.255-.52l.292.16c1.64.892 3.433-.902 2.54-2.541l-.159-.292a.873.873 0 01.52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 01-.52-1.255l.16-.292c.892-1.64-.901-3.433-2.541-2.54l-.292.159a.873.873 0 01-1.255-.52l-.094-.319z"/>
      </svg>
      <span class="nav-label">Settings</span>
    </div>
  </nav>

  <div id="sidebar-footer">
    <div class="status-row">
      <div class="dot" id="status-dot"></div>
      <span id="status-text">Connecting…</span>
    </div>
    <div id="uptime-small"></div>
  </div>
</div>

<!-- ── Main content ─────────────────────────────────────────────────────────── -->
<div id="content">
  <div id="page-header">
    <span id="page-title">Overview</span>
    <span id="project-badge" style="display:none"></span>
    <span id="header-uptime"></span>
    <span id="conn-pill">● live</span>
  </div>

  <div id="pages">

    <!-- ─── Overview ──────────────────────────────────────────────────────── -->
    <div class="page active" id="page-overview">
      <div class="cards-grid">
        <div class="card c-green">
          <div class="card-label">Tokens Saved</div>
          <div class="card-value" id="c-tokens">—</div>
          <div class="card-sub" id="c-chars">— chars</div>
        </div>
        <div class="card c-blue">
          <div class="card-label">Compression</div>
          <div class="card-value" id="c-pct">—</div>
          <div class="card-sub">of tool results</div>
        </div>
        <div class="card c-yellow">
          <div class="card-label">Requests</div>
          <div class="card-value" id="c-req">—</div>
          <div class="card-sub" id="c-compressions">— compressions</div>
        </div>
        <div class="card c-orange">
          <div class="card-label">Est. Cost Saved</div>
          <div class="card-value" id="c-cost">—</div>
          <div class="card-sub">@ $3 / MTok</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Context pressure — last request</div>
        <div class="bar-row">
          <span class="bar-label">Before compression</span>
          <div class="bar-track"><div class="bar-fill" id="bar-msg" style="width:0%"></div></div>
          <span class="bar-val" id="pct-msg">0%</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">After compression</span>
          <div class="bar-track"><div class="bar-fill" id="bar-out" style="width:0%"></div></div>
          <span class="bar-val" id="pct-out">0%</span>
        </div>
        <div class="bar-row" style="margin-bottom:0">
          <span class="bar-label">Session cache hits</span>
          <div class="bar-track"><div class="bar-fill" id="bar-cache" style="width:0%;background:var(--purple)"></div></div>
          <span class="bar-val" id="pct-cache">0</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Activity — tokens saved per request <span style="font-weight:400;text-transform:none;letter-spacing:0">(last 60)</span></div>
        <canvas id="sparkline"></canvas>
      </div>

      <div class="section">
        <div class="section-title">By tool</div>
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
            <tr><td colspan="4" style="color:var(--muted);padding:14px 8px;text-align:center">No data yet…</td></tr>
          </tbody>
        </table>
      </div>

      <div class="cache-row">
        <div class="cache-card">
          <div class="cache-label">Session cache</div>
          <div class="cache-val" id="c-scache">—</div>
        </div>
        <div class="cache-card">
          <div class="cache-label">Expand store</div>
          <div class="cache-val" id="c-expand">—</div>
        </div>
        <div class="cache-card">
          <div class="cache-label">LRU cache</div>
          <div class="cache-val" id="c-lru">—</div>
        </div>
        <div class="cache-card">
          <div class="cache-label">Pattern hits</div>
          <div class="cache-val" id="c-patterns">—</div>
        </div>
      </div>
    </div>

    <!-- ─── Projects ──────────────────────────────────────────────────────── -->
    <div class="page" id="page-projects">
      <div class="section" style="margin-bottom:0">
        <div class="section-title" id="projects-section-title">All projects — this session + history</div>
        <table class="project-table">
          <thead>
            <tr>
              <th>Project</th>
              <th class="td-right">Sessions</th>
              <th class="td-right">Requests</th>
              <th class="td-right">Tokens saved</th>
              <th class="td-right">Last seen</th>
            </tr>
          </thead>
          <tbody id="projects-body">
            <tr><td colspan="5" style="color:var(--muted);padding:20px 8px;text-align:center">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ─── History ───────────────────────────────────────────────────────── -->
    <div class="page" id="page-history">
      <div id="hist-layout">
        <div id="hist-projects">
          <div style="padding:10px 14px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:600;border-bottom:1px solid var(--border)">Projects</div>
          <div id="hist-proj-list"></div>
        </div>
        <div id="hist-sessions">
          <div class="hist-sessions-header" id="hist-sessions-header">Select a project</div>
          <div id="hist-sessions-list"><div class="empty-msg">Select a project on the left to view sessions.</div></div>
        </div>
      </div>
    </div>

    <!-- ─── Settings ─────────────────────────────────────────────────────── -->
    <div class="page" id="page-settings">
      <div class="section" style="margin-bottom:14px">
        <div class="section-title">Compression mode</div>
        <div class="mode-btns">
          <button class="mode-btn" data-mode="soft">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
            </svg>
            Soft
          </button>
          <button class="mode-btn active" data-mode="normal">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
              <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
              <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
              <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/>
              <line x1="17" y1="16" x2="23" y2="16"/>
            </svg>
            Normal
          </button>
          <button class="mode-btn" data-mode="aggressive">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            Aggressive
          </button>
          <button class="mode-btn" data-mode="critical">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Critical
          </button>
        </div>
        <div id="mode-desc">Normal — threshold 800 chars, last 3 results uncompressed</div>
      </div>

      <div class="section">
        <div class="section-title">Configuration</div>
        <div id="config-rows">
          <div class="config-row"><span class="config-key">Mode</span><span class="config-val" id="cfg-mode">—</span></div>
          <div class="config-row"><span class="config-key">Port</span><span class="config-val" id="cfg-port">—</span></div>
          <div class="config-row"><span class="config-key">Dry-run</span><span class="config-val" id="cfg-dryrun">—</span></div>
          <div class="config-row"><span class="config-key">LRU cache entries</span><span class="config-val" id="cfg-lru">—</span></div>
          <div class="config-row"><span class="config-key">Session cache entries</span><span class="config-val" id="cfg-scache">—</span></div>
          <div class="config-row"><span class="config-key">Version</span><span class="config-val" id="cfg-version">—</span></div>
        </div>
      </div>

      <div class="section" style="margin-bottom:0">
        <div class="section-title">Links</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px">
          <a href="/squeezr/stats" target="_blank">/squeezr/stats JSON</a>
          <a href="/squeezr/history" target="_blank">/squeezr/history JSON</a>
          <a href="/squeezr/projects" target="_blank">/squeezr/projects JSON</a>
          <a href="https://github.com/sergioramosv/Squeezr" target="_blank">GitHub</a>
        </div>
      </div>
    </div>

  </div><!-- /pages -->

  <div id="footer">
    <span>Squeezr v<span id="f-version">—</span></span>
    <span id="f-mode">mode: active</span>
    <span id="f-port"></span>
    <span id="conn-status" style="margin-left:auto;color:var(--green)">● connected</span>
  </div>
</div><!-- /content -->

</div><!-- /app -->

<script>
// ── Sparkline ────────────────────────────────────────────────────────────────
const MAX_PTS = 60
const sparkData = []
let lastTokens = 0
function pushSpark(t) {
  sparkData.push(Math.max(0, t - lastTokens))
  lastTokens = t
  if (sparkData.length > MAX_PTS) sparkData.shift()
}
function drawSpark() {
  const cv = document.getElementById('sparkline')
  if (!cv) return
  const dpr = window.devicePixelRatio || 1
  const r = cv.getBoundingClientRect()
  cv.width = r.width * dpr; cv.height = r.height * dpr
  const ctx = cv.getContext('2d')
  ctx.scale(dpr, dpr)
  const w = r.width, h = r.height
  const mx = Math.max(...sparkData, 1)
  ctx.clearRect(0, 0, w, h)
  if (sparkData.length < 2) return
  const step = w / (MAX_PTS - 1)
  ctx.beginPath(); ctx.moveTo(0, h)
  sparkData.forEach((v, i) => ctx.lineTo(i * step, h - (v / mx) * (h - 4)))
  ctx.lineTo((sparkData.length - 1) * step, h)
  ctx.closePath()
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, 'rgba(63,185,80,.3)'); g.addColorStop(1, 'rgba(63,185,80,0)')
  ctx.fillStyle = g; ctx.fill()
  ctx.beginPath()
  sparkData.forEach((v, i) => {
    const x = i * step, y = h - (v / mx) * (h - 4)
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.strokeStyle = '#3fb950'; ctx.lineWidth = 1.5; ctx.stroke()
}
window.addEventListener('resize', drawSpark)

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtN(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}
function fmtCost(tok) {
  const u = (tok / 1e6) * 3
  return u < 0.01 ? '<$0.01' : u < 1 ? '$' + u.toFixed(3) : '$' + u.toFixed(2)
}
function fmtUptime(s) {
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's'
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm'
}
function fmtTs(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
}
function fmtTime(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  return d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})
}
function fmtDur(startMs, endMs) {
  const s = Math.round((endMs - startMs) / 1000)
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's'
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm'
}
function barColor(p) {
  if (p >= 90) return 'var(--red)'
  if (p >= 75) return 'var(--yellow)'
  if (p >= 50) return 'var(--orange)'
  return 'var(--blue)'
}
function setBar(bid, vid, pct, label, noColor) {
  const b = document.getElementById(bid), v = document.getElementById(vid)
  b.style.width = Math.min(pct, 100) + '%'
  if (!noColor) b.style.background = barColor(pct)
  v.textContent = label
}
const PROJECT_COLORS = ['#58a6ff','#3fb950','#ffa657','#bc8cff','#d29922','#f85149','#79c0ff','#56d364']
function projectColor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return PROJECT_COLORS[h % PROJECT_COLORS.length]
}

// ── Overview render ──────────────────────────────────────────────────────────
function renderOverview(d) {
  document.getElementById('c-tokens').textContent = fmtN(d.total_saved_tokens)
  document.getElementById('c-chars').textContent = (d.total_saved_chars || 0).toLocaleString() + ' chars'
  document.getElementById('c-pct').textContent = (d.savings_pct || 0) + '%'
  document.getElementById('c-req').textContent = fmtN(d.requests || 0)
  document.getElementById('c-compressions').textContent = (d.compressions || 0) + ' compressions'
  document.getElementById('c-cost').textContent = fmtCost(d.total_saved_tokens || 0)
  document.getElementById('f-version').textContent = d.version || '—'
  document.getElementById('sb-ver').textContent = 'v' + (d.version || '—')
  document.getElementById('f-mode').textContent = 'mode: ' + (d.dry_run ? 'dry-run' : 'active')
  document.getElementById('f-port').textContent = 'port: ' + (d.port || '—')
  document.getElementById('header-uptime').textContent = 'uptime ' + fmtUptime(d.uptime_seconds || 0)
  document.getElementById('uptime-small').textContent = fmtUptime(d.uptime_seconds || 0)

  // Project badge
  const proj = d.current_project
  const badge = document.getElementById('project-badge')
  if (proj && proj !== 'unknown') {
    badge.textContent = proj
    badge.style.display = ''
    badge.style.borderColor = projectColor(proj)
    badge.style.color = projectColor(proj)
  } else {
    badge.style.display = 'none'
  }

  // Pressure bars
  const msgPct = Math.min(Math.round((d.last_original_chars || 0) / 80), 100)
  const outPct = Math.min(Math.round((d.last_compressed_chars || 0) / 80), 100)
  const ch = d.session_cache_hits || 0
  const cachePct = Math.round((ch / Math.max(ch + (d.compressions || 1), 1)) * 100)
  setBar('bar-msg', 'pct-msg', msgPct, msgPct + '%')
  setBar('bar-out', 'pct-out', outPct, outPct + '%')
  setBar('bar-cache', 'pct-cache', cachePct, ch, true)

  // Sparkline
  pushSpark(d.total_saved_tokens || 0)
  drawSpark()

  // Tool table
  const bt = d.by_tool || {}
  const rows = Object.entries(bt).sort((a, b) => b[1].saved_tokens - a[1].saved_tokens)
  const maxSaved = rows[0]?.[1]?.saved_tokens || 1
  const tbody = document.getElementById('tools-body')
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted);padding:14px 8px;text-align:center">No tool results compressed yet…</td></tr>'
  } else {
    tbody.innerHTML = rows.map(([tool, t]) => {
      const bw = Math.round((t.saved_tokens / maxSaved) * 72)
      return \`<tr>
        <td><code class="tag">\${tool}</code></td>
        <td class="td-right" style="color:var(--muted)">\${t.count}</td>
        <td class="td-right">\${fmtN(t.saved_tokens)}</td>
        <td><span class="mini-bar" style="width:\${bw}px;background:var(--green)"></span>\${t.avg_pct}%</td>
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

  // Settings config panel
  document.getElementById('cfg-mode').textContent = d.mode || '—'
  document.getElementById('cfg-port').textContent = d.port || '—'
  document.getElementById('cfg-dryrun').textContent = d.dry_run ? 'yes' : 'no'
  document.getElementById('cfg-lru').textContent = d.cache?.size ?? '—'
  document.getElementById('cfg-scache').textContent = d.session_cache_size ?? '—'
  document.getElementById('cfg-version').textContent = d.version || '—'

  // Sync active mode button
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === d.mode)
  })
  const modeMap = {
    soft: 'Soft — threshold 3000 chars, last 10 results uncompressed, no AI',
    normal: 'Normal — threshold 800 chars, last 3 results uncompressed',
    aggressive: 'Aggressive — threshold 200 chars, last 1 result uncompressed',
    critical: 'Critical — threshold 50 chars, everything compressed'
  }
  document.getElementById('mode-desc').textContent = modeMap[d.mode] || ''
}

// ── Projects page ────────────────────────────────────────────────────────────
async function loadProjects() {
  try {
    const r = await fetch('/squeezr/projects')
    const { projects } = await r.json()
    const tbody = document.getElementById('projects-body')
    const entries = Object.entries(projects).sort((a, b) => b[1].savedTokens - a[1].savedTokens)
    if (entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);padding:20px 8px;text-align:center">No project data yet — start making requests.</td></tr>'
      return
    }
    tbody.innerHTML = entries.map(([name, p]) => \`<tr>
      <td><span class="project-dot" style="background:\${projectColor(name)}"></span><code>\${name}</code></td>
      <td class="td-right" style="color:var(--muted)">\${p.sessions}</td>
      <td class="td-right">\${p.requests}</td>
      <td class="td-right" style="color:var(--green)">\${fmtN(p.savedTokens)}</td>
      <td class="td-right" style="color:var(--muted);font-size:11px">\${p.lastSeen ? fmtTs(p.lastSeen) : '—'}</td>
    </tr>\`).join('')
  } catch {
    document.getElementById('projects-body').innerHTML = '<tr><td colspan="5" style="color:var(--muted);padding:20px 8px;text-align:center">Failed to load projects.</td></tr>'
  }
}

// ── History page ─────────────────────────────────────────────────────────────
let histData = null
let selectedHistProj = '__all__'

async function loadHistory() {
  try {
    const r = await fetch('/squeezr/history')
    histData = await r.json()
    renderHistProjects()
    renderHistSessions()
  } catch {
    document.getElementById('hist-proj-list').innerHTML = '<div class="empty-msg">Failed to load history.</div>'
  }
}

function renderHistProjects() {
  if (!histData) return
  const all = [...histData.sessions]
  if (histData.current && histData.current.requests > 0) {
    const idx = all.findIndex(s => s.id === histData.current.id)
    if (idx >= 0) all[idx] = histData.current; else all.push(histData.current)
  }

  // Group by project
  const byProj = {}
  for (const s of all) {
    if (!byProj[s.project]) byProj[s.project] = 0
    byProj[s.project]++
  }

  const list = document.getElementById('hist-proj-list')
  let html = \`<div class="hist-proj-item\${selectedHistProj === '__all__' ? ' active' : ''}" data-proj="__all__">
    <span>All projects</span>
    <span class="hist-proj-count">\${all.length}</span>
  </div>\`
  for (const [name, cnt] of Object.entries(byProj).sort((a, b) => b[1] - a[1])) {
    const active = selectedHistProj === name ? ' active' : ''
    html += \`<div class="hist-proj-item\${active}" data-proj="\${name}">
      <span><span class="project-dot" style="background:\${projectColor(name)}"></span>\${name}</span>
      <span class="hist-proj-count">\${cnt}</span>
    </div>\`
  }
  list.innerHTML = html

  list.querySelectorAll('.hist-proj-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedHistProj = el.dataset.proj
      list.querySelectorAll('.hist-proj-item').forEach(x => x.classList.remove('active'))
      el.classList.add('active')
      renderHistSessions()
    })
  })
}

function renderHistSessions() {
  if (!histData) return
  let sessions = [...histData.sessions]
  if (histData.current && histData.current.requests > 0) {
    const idx = sessions.findIndex(s => s.id === histData.current.id)
    if (idx >= 0) sessions[idx] = histData.current; else sessions.push(histData.current)
  }
  // Sort newest first
  sessions.sort((a, b) => b.startTime - a.startTime)

  if (selectedHistProj !== '__all__') {
    sessions = sessions.filter(s => s.project === selectedHistProj)
  }

  const header = document.getElementById('hist-sessions-header')
  header.textContent = selectedHistProj === '__all__'
    ? \`All sessions (\${sessions.length})\`
    : \`\${selectedHistProj} — \${sessions.length} session\${sessions.length !== 1 ? 's' : ''}\`

  const list = document.getElementById('hist-sessions-list')
  if (sessions.length === 0) {
    list.innerHTML = '<div class="empty-msg">No sessions found.</div>'
    return
  }

  // Group by day
  const byDay = {}
  for (const s of sessions) {
    const day = new Date(s.startTime).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(s)
  }

  let html = ''
  for (const [day, daySessions] of Object.entries(byDay)) {
    html += \`<div style="padding:8px 16px;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;background:var(--bg3);border-bottom:1px solid var(--border)">\${day}</div>\`
    for (const s of daySessions) {
      const isCurrent = s.id === histData.current?.id
      const projBadge = selectedHistProj === '__all__' ? \`<span class="session-project-badge">\${s.project}</span>\` : ''
      html += \`<div class="session-card">
        <div class="session-date">
          \${fmtTime(s.startTime)} → \${fmtTime(s.endTime)}
          <span style="color:var(--muted);font-weight:400"> (\${fmtDur(s.startTime, s.endTime)})</span>
          \${isCurrent ? '<span style="font-size:10px;color:var(--green);margin-left:8px">● active</span>' : ''}
          \${projBadge}
        </div>
        <div class="session-stats">
          <div class="session-stat">Requests: <span>\${s.requests}</span></div>
          <div class="session-stat">Tokens saved: <span style="color:var(--green)">\${fmtN(s.savedTokens)}</span></div>
          <div class="session-stat">Compressions: <span>\${s.compressions}</span></div>
        </div>
      </div>\`
    }
  }
  list.innerHTML = html
}

// ── Navigation ────────────────────────────────────────────────────────────────
const pageTitles = { overview: 'Overview', projects: 'Projects', history: 'History', settings: 'Settings' }

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    item.classList.add('active')
    document.getElementById('page-' + page).classList.add('active')
    document.getElementById('page-title').textContent = pageTitles[page] || page
    if (page === 'projects') loadProjects()
    if (page === 'history') loadHistory()
  })
})

// ── Mode selector ─────────────────────────────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    try {
      await fetch('/squeezr/config', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ mode })
      })
    } catch(e) { console.error('mode update failed', e) }
  })
})

// ── SSE ───────────────────────────────────────────────────────────────────────
const dot = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')
const connPill = document.getElementById('conn-pill')
const connStatus = document.getElementById('conn-status')

function connect() {
  const es = new EventSource('/squeezr/events')
  es.onmessage = e => {
    try {
      renderOverview(JSON.parse(e.data))
    } catch(err) { console.error(err) }
  }
  es.onopen = () => {
    dot.classList.remove('off')
    statusText.textContent = 'Running'
    connPill.className = ''
    connPill.textContent = '● live'
    connStatus.style.color = 'var(--green)'
    connStatus.textContent = '● connected'
  }
  es.onerror = () => {
    dot.classList.add('off')
    statusText.textContent = 'Reconnecting…'
    connPill.className = 'err'
    connPill.textContent = '● offline'
    connStatus.style.color = 'var(--red)'
    connStatus.textContent = '● reconnecting…'
    es.close()
    setTimeout(connect, 3000)
  }
}
connect()
</script>
</body>
</html>`
