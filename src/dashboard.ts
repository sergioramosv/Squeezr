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
  --bg:#09090b;--bg2:#111113;--bg3:#1a1a1e;--bg4:#252529;
  --border:#2a2a2e;--text:#e4e4e7;--muted:#71717a;
  --green:#22c55e;--yellow:#eab308;--red:#ef4444;
  --blue:#22c55e;--purple:#a78bfa;--orange:#f59e0b;--accent:#16a34a
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

/* ── Limits page ── */
.limits-cli-section{background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:14px}
.limits-cli-header{display:flex;align-items:center;gap:8px;margin-bottom:12px}
.limits-cli-name{font-size:13px;font-weight:600;color:var(--text)}
.limits-cli-badge{font-size:10px;padding:1px 7px;border-radius:10px;border:1px solid;margin-left:2px}
.limits-cli-badge.live{border-color:rgba(63,185,80,.4);color:var(--green);background:rgba(63,185,80,.1)}
.limits-cli-badge.error{border-color:rgba(248,81,73,.4);color:var(--red);background:rgba(248,81,73,.1)}
.limits-cli-badge.warn{border-color:rgba(210,153,34,.4);color:var(--yellow);background:rgba(210,153,34,.1)}
.limits-cli-badge.none{border-color:var(--border);color:var(--muted);background:transparent}
.limits-gauge-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:10px}
.limits-gauge{background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 12px}
.limits-gauge-label{font-size:11px;color:var(--muted);margin-bottom:6px;display:flex;justify-content:space-between}
.limits-gauge-bar{height:6px;background:var(--bg4);border-radius:3px;overflow:hidden;margin-bottom:5px}
.limits-gauge-fill{height:100%;border-radius:3px;transition:width .5s,background .5s}
.limits-gauge-bottom{display:flex;justify-content:space-between;font-size:11px}
.limits-gauge-remaining{color:var(--text);font-weight:500}
.limits-gauge-reset{color:var(--muted)}
.limits-usage-row{display:flex;gap:16px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--border);margin-top:4px}
.limits-usage-item{font-size:12px;color:var(--muted)}
.limits-usage-item span{color:var(--text);font-weight:500}
.limits-no-data{padding:16px;text-align:center;color:var(--muted);font-size:12px}
.limits-billing-row{display:flex;gap:10px;flex-wrap:wrap;padding:8px 0 2px}
.limits-credit-card{flex:1;min-width:120px;background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 12px}
.limits-credit-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.limits-credit-val{font-size:20px;font-weight:600;color:var(--green)}
.limits-budget-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px}
.limits-budget-input{background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:5px 10px;color:var(--text);font-size:12px;width:140px;outline:none}
.limits-budget-input:focus{border-color:var(--blue)}
.limits-budget-label{font-size:12px;color:var(--muted)}

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
    <div class="logo" style="display:flex;align-items:center;gap:8px">
      <svg width="24" height="24" viewBox="0 0 80 80" fill="none"><rect width="80" height="80" rx="16" fill="#16a34a"/><rect x="8" y="14" width="64" height="10" rx="5" fill="white" opacity="0.35"/><rect x="16" y="35" width="48" height="10" rx="5" fill="white" opacity="0.65"/><rect x="24" y="56" width="32" height="10" rx="5" fill="white" opacity="1"/></svg>
      Squee<span>zr</span>
    </div>
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
    <div class="nav-item" data-page="limits">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
        <line x1="2" y1="20" x2="22" y2="20"/>
      </svg>
      <span class="nav-label">Limits</span>
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
  </div>
</div>

<!-- ── Main content ─────────────────────────────────────────────────────────── -->
<div id="content">
  <div id="page-header">
    <span id="page-title">Overview</span>
    <span id="project-badge" style="display:none"></span>
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

      <!-- Savings breakdown -->
      <div class="section">
        <div class="section-title">Savings Breakdown</div>
        <div class="cache-grid" style="grid-template-columns:1fr 1fr 1fr">
          <div class="cache-item">
            <div class="cache-label">Deterministic</div>
            <div class="cache-val" id="bd-det" style="color:var(--green)">—</div>
          </div>
          <div class="cache-item">
            <div class="cache-label">AI compression</div>
            <div class="cache-val" id="bd-ai" style="color:var(--blue)">—</div>
          </div>
          <div class="cache-item">
            <div class="cache-label">Read dedup</div>
            <div class="cache-val" id="bd-dedup" style="color:var(--purple)">—</div>
          </div>
          <div class="cache-item">
            <div class="cache-label">System prompt</div>
            <div class="cache-val" id="bd-sysprompt">—</div>
          </div>
          <div class="cache-item">
            <div class="cache-label">Tag overhead</div>
            <div class="cache-val" id="bd-overhead" style="color:var(--muted)">—</div>
          </div>
          <div class="cache-item">
            <div class="cache-label">AI calls</div>
            <div class="cache-val" id="bd-aicalls" style="color:var(--muted)">—</div>
          </div>
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

    <!-- ─── Limits ───────────────────────────────────────────────────────── -->
    <div class="page" id="page-limits">

      <!-- Anthropic -->
      <div class="limits-cli-section" id="lim-anthropic">
        <div class="limits-cli-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:var(--orange)">
            <path d="M13.83 2.34a2.09 2.09 0 0 0-3.66 0L1.13 18.9A2.09 2.09 0 0 0 2.96 22h18.08a2.09 2.09 0 0 0 1.83-3.1L13.83 2.34ZM12 8a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0V9a1 1 0 0 1 1-1Zm0 10a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/>
          </svg>
          <svg width="16" height="16" fill="var(--text)" viewBox="0 0 16 16" style="vertical-align:middle;margin-right:6px"><path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/></svg><span class="limits-cli-name">Anthropic · Claude Code</span>
          <span class="limits-cli-badge none" id="ant-badge">no data yet</span>
        </div>
        <div class="limits-gauge-grid">
          <div class="limits-gauge">
            <div class="limits-gauge-label">
              <span id="ant-tok-label">Tokens / minute</span>
              <span id="ant-tok-pct" style="color:var(--muted)">—</span>
            </div>
            <div class="limits-gauge-bar"><div class="limits-gauge-fill" id="ant-tok-fill" style="width:0%"></div></div>
            <div class="limits-gauge-bottom">
              <span class="limits-gauge-remaining" id="ant-tok-rem">—</span>
              <span class="limits-gauge-reset" id="ant-tok-reset"></span>
            </div>
          </div>
          <div class="limits-gauge">
            <div class="limits-gauge-label">
              <span id="ant-req-label">Requests / minute</span>
              <span id="ant-req-pct" style="color:var(--muted)">—</span>
            </div>
            <div class="limits-gauge-bar"><div class="limits-gauge-fill" id="ant-req-fill" style="width:0%"></div></div>
            <div class="limits-gauge-bottom">
              <span class="limits-gauge-remaining" id="ant-req-rem">—</span>
              <span class="limits-gauge-reset" id="ant-req-reset"></span>
            </div>
          </div>
          <div class="limits-gauge">
            <div class="limits-gauge-label">
              <span id="ant-inp-label">Input tokens / minute</span>
              <span id="ant-inp-pct" style="color:var(--muted)">—</span>
            </div>
            <div class="limits-gauge-bar"><div class="limits-gauge-fill" id="ant-inp-fill" style="width:0%"></div></div>
            <div class="limits-gauge-bottom">
              <span class="limits-gauge-remaining" id="ant-inp-rem">—</span>
              <span class="limits-gauge-reset" id="ant-inp-reset"></span>
            </div>
          </div>
          <div class="limits-gauge">
            <div class="limits-gauge-label">
              <span id="ant-out-label">Output tokens / minute</span>
              <span id="ant-out-pct" style="color:var(--muted)">—</span>
            </div>
            <div class="limits-gauge-bar"><div class="limits-gauge-fill" id="ant-out-fill" style="width:0%"></div></div>
            <div class="limits-gauge-bottom">
              <span class="limits-gauge-remaining" id="ant-out-rem">—</span>
              <span class="limits-gauge-reset" id="ant-out-reset"></span>
            </div>
          </div>
        </div>
        <div class="limits-usage-row">
          <div class="limits-usage-item">Session input: <span id="ant-u-inp-s">—</span></div>
          <div class="limits-usage-item">Session output: <span id="ant-u-out-s">—</span></div>
          <div class="limits-usage-item">Today input: <span id="ant-u-inp-d">—</span></div>
          <div class="limits-usage-item">Today output: <span id="ant-u-out-d">—</span></div>
          <div class="limits-usage-item" style="margin-left:auto">
            <a href="https://console.anthropic.com/settings/usage" target="_blank" style="color:var(--muted);font-size:11px">View billing ↗</a>
          </div>
        </div>
      </div>

      <!-- OpenAI -->
      <div class="limits-cli-section" id="lim-openai">
        <div class="limits-cli-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:var(--text)">
            <path d="M22.28 9.27a6.17 6.17 0 0 0-.53-5.06 6.24 6.24 0 0 0-6.7-2.99A6.23 6.23 0 0 0 10.36 0a6.24 6.24 0 0 0-5.95 4.32 6.23 6.23 0 0 0-4.16 3.02 6.24 6.24 0 0 0 .77 7.32 6.17 6.17 0 0 0 .53 5.06 6.24 6.24 0 0 0 6.7 2.99A6.23 6.23 0 0 0 13.64 24a6.25 6.25 0 0 0 5.96-4.33 6.23 6.23 0 0 0 4.15-3.02 6.24 6.24 0 0 0-.77-7.31l.3-.07ZM13.64 22.5a4.63 4.63 0 0 1-2.97-1.08l.15-.08 4.93-2.85a.82.82 0 0 0 .41-.71v-6.96l2.08 1.2a.08.08 0 0 1 .04.06v5.76a4.65 4.65 0 0 1-4.64 4.66Zm-9.95-4.27a4.63 4.63 0 0 1-.55-3.12l.14.09 4.93 2.85a.82.82 0 0 0 .82 0l6.02-3.47v2.4a.08.08 0 0 1-.03.06L10.06 20a4.65 4.65 0 0 1-6.37-1.77Zm-1.28-10.8a4.63 4.63 0 0 1 2.42-2.04v5.88a.82.82 0 0 0 .41.71l6.01 3.47-2.08 1.2a.08.08 0 0 1-.08 0L4.22 13.7a4.65 4.65 0 0 1-.81-6.27Zm17.09 3.99-6.02-3.48L15.56 7a.08.08 0 0 1 .08 0l4.87 2.81a4.64 4.64 0 0 1-.72 8.38v-5.88a.82.82 0 0 0-.39-.69Zm2.07-3.14-.14-.09-4.92-2.87a.82.82 0 0 0-.83 0L9.67 9.79V7.4a.08.08 0 0 1 .03-.06L14.6 4.5a4.64 4.64 0 0 1 6.9 4.81l.07-.03Zm-13.03 4.28-2.08-1.2a.08.08 0 0 1-.04-.06V5.5a4.64 4.64 0 0 1 7.62-3.56l-.15.08L7.9 4.87a.82.82 0 0 0-.41.71l-.01 6.98Zm1.13-2.43 2.68-1.55 2.68 1.55v3.1l-2.68 1.54-2.68-1.54v-3.1Z"/>
          </svg>
          <svg width="16" height="16" fill="var(--text)" viewBox="0 0 16 16" style="vertical-align:middle;margin-right:6px"><path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057 3.233 1.84a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"/></svg><span class="limits-cli-name">OpenAI · Codex</span>
          <span class="limits-cli-badge none" id="oai-badge">no data yet</span>
        </div>
        <div class="limits-gauge-grid">
          <div class="limits-gauge">
            <div class="limits-gauge-label">
              <span id="oai-tok-label">Session window</span>
              <span id="oai-tok-pct" style="color:var(--muted)">—</span>
            </div>
            <div class="limits-gauge-bar"><div class="limits-gauge-fill" id="oai-tok-fill" style="width:0%"></div></div>
            <div class="limits-gauge-bottom">
              <span class="limits-gauge-remaining" id="oai-tok-rem">—</span>
              <span class="limits-gauge-reset" id="oai-tok-reset"></span>
            </div>
          </div>
          <div class="limits-gauge">
            <div class="limits-gauge-label">
              <span id="oai-req-label">Weekly window</span>
              <span id="oai-req-pct" style="color:var(--muted)">—</span>
            </div>
            <div class="limits-gauge-bar"><div class="limits-gauge-fill" id="oai-req-fill" style="width:0%"></div></div>
            <div class="limits-gauge-bottom">
              <span class="limits-gauge-remaining" id="oai-req-rem">—</span>
              <span class="limits-gauge-reset" id="oai-req-reset"></span>
            </div>
          </div>
        </div>
        <div class="limits-billing-row" id="oai-billing-row" style="display:none">
          <div class="limits-credit-card">
            <div class="limits-credit-label">Credits remaining</div>
            <div class="limits-credit-val" id="oai-credits">—</div>
          </div>
          <div class="limits-credit-card">
            <div class="limits-credit-label">Hard limit</div>
            <div class="limits-credit-val" style="color:var(--yellow)" id="oai-hard-lim">—</div>
          </div>
        </div>
        <div class="limits-usage-row">
          <div class="limits-usage-item">Session input: <span id="oai-u-inp-s">—</span></div>
          <div class="limits-usage-item">Session output: <span id="oai-u-out-s">—</span></div>
          <div class="limits-usage-item">Today input: <span id="oai-u-inp-d">—</span></div>
          <div class="limits-usage-item">Today output: <span id="oai-u-out-d">—</span></div>
          <div class="limits-usage-item" style="margin-left:auto">
            <a href="https://platform.openai.com/usage" target="_blank" style="color:var(--muted);font-size:11px">View billing ↗</a>
          </div>
        </div>
      </div>

      <!-- Gemini -->
      <div class="limits-cli-section" id="lim-gemini">
        <div class="limits-cli-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="color:var(--blue)">
            <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm0 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.49 10 10-4.49 10-10 10zm-1-14h2v7h-2zm0 9h2v2h-2z"/>
          </svg>
          <svg width="16" height="16" fill="var(--text)" viewBox="0 0 16 16" style="vertical-align:middle;margin-right:6px"><path d="M15.545 6.558a9.4 9.4 0 0 1 .139 1.626c0 2.434-.87 4.492-2.384 5.885h.002C11.978 15.292 10.158 16 8 16A8 8 0 1 1 8 0a7.7 7.7 0 0 1 5.352 2.082l-2.284 2.284A4.35 4.35 0 0 0 8 3.166c-2.087 0-3.86 1.408-4.492 3.304a4.8 4.8 0 0 0 0 3.063h.003c.635 1.893 2.405 3.301 4.492 3.301 1.078 0 2.004-.276 2.722-.764h-.003a3.7 3.7 0 0 0 1.599-2.431H8v-3.08z"/></svg><span class="limits-cli-name">Google · Gemini CLI</span>
          <span class="limits-cli-badge warn" id="gem-badge">only on 429 errors</span>
        </div>
        <div id="gem-nodata" class="limits-no-data">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:6px;display:block;margin-inline:auto;opacity:.4">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Google does not expose quota headers on successful responses.<br>
          Data appears here only after a 429 rate-limit error.<br>
          <a href="https://aistudio.google.com/app/usage" target="_blank" style="margin-top:8px;display:inline-block">View quotas in AI Studio ↗</a>
        </div>
        <div id="gem-data" style="display:none">
          <div class="limits-gauge-grid">
            <div class="limits-gauge">
              <div class="limits-gauge-label"><span>Last known token limit</span></div>
              <div class="limits-gauge-bottom">
                <span class="limits-gauge-remaining" id="gem-tok-lim">—</span>
                <span class="limits-gauge-reset" id="gem-errors">0 errors</span>
              </div>
            </div>
          </div>
        </div>
        <div class="limits-usage-row">
          <div class="limits-usage-item">Session input: <span id="gem-u-inp-s">—</span></div>
          <div class="limits-usage-item">Session output: <span id="gem-u-out-s">—</span></div>
          <div class="limits-usage-item">Today input: <span id="gem-u-inp-d">—</span></div>
          <div class="limits-usage-item">Today output: <span id="gem-u-out-d">—</span></div>
          <div class="limits-usage-item" style="margin-left:auto">
            <a href="https://aistudio.google.com/app/usage" target="_blank" style="color:var(--muted);font-size:11px">View quotas ↗</a>
          </div>
        </div>
      </div>

      <!-- Personal budget -->
      <div class="limits-cli-section" style="margin-bottom:0">
        <div class="limits-cli-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4l3 3"/>
          </svg>
          <span class="limits-cli-name">Personal daily budget</span>
          <span class="limits-cli-badge none">optional</span>
        </div>
        <div class="limits-budget-row">
          <input class="limits-budget-input" id="budget-input" type="number" placeholder="e.g. 5000000" min="0">
          <span class="limits-budget-label">tokens / day</span>
          <button class="btn-save" id="budget-save" style="padding:4px 12px;font-size:11px;border-radius:6px;border:1px solid var(--border);background:var(--bg3);color:var(--muted);cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--blue)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">Save</button>
        </div>
        <div id="budget-bar-wrap" style="margin-top:10px;display:none">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:5px">
            <span>Tokens used today through Squeezr</span>
            <span id="budget-pct-label">0%</span>
          </div>
          <div class="limits-gauge-bar" style="height:10px">
            <div class="limits-gauge-fill" id="budget-bar" style="width:0%"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:4px">
            <span id="budget-used-label">0 used</span>
            <span id="budget-limit-label">of —</span>
          </div>
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
function timeAgo(ms) {
  if (!ms) return ''
  const diff = Math.round((Date.now() - ms) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
  if (diff < 172800) return 'yesterday'
  return Math.floor(diff / 86400) + 'd ago'
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
  // uptime removed from UI

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

  // Savings breakdown
  const bd = d.breakdown
  if (bd) {
    const fmtC = (n) => n > 0 ? '-' + fmtN(n) : '0'
    document.getElementById('bd-det').textContent = fmtC(bd.deterministic)
    document.getElementById('bd-ai').textContent = fmtC(bd.ai_compression)
    document.getElementById('bd-dedup').textContent = fmtC(bd.read_dedup)
    document.getElementById('bd-sysprompt').textContent = fmtC(bd.system_prompt)
    document.getElementById('bd-overhead').textContent = bd.overhead > 0 ? '+' + fmtN(bd.overhead) : '0'
    document.getElementById('bd-aicalls').textContent = bd.ai_calls > 0 ? bd.ai_calls + ' calls' : '0'
  }
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
  // Filter empty sessions and sort newest first
  sessions = sessions.filter(s => s.requests > 0)
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
          <span style="color:var(--muted);font-weight:400;margin-left:6px">\${timeAgo(s.endTime)}</span>
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

// ── Limits page ─────────────────────────────────────────────────────────────
let limitsCountdownTimer = null

function fmtTokens(n) {
  if (!n && n !== 0) return '—'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

function gaugeColor(pct) {
  if (pct >= 90) return 'var(--red)'
  if (pct >= 70) return 'var(--yellow)'
  if (pct >= 40) return 'var(--orange)'
  return 'var(--green)'
}

function fillGauge(fillId, pctId, remId, resetId, remaining, limit, resetEpoch) {
  if (!limit) {
    document.getElementById(fillId).style.width = '0%'
    document.getElementById(pctId).textContent = '—'
    document.getElementById(remId).textContent = '—'
    if (resetId) document.getElementById(resetId).textContent = ''
    return
  }
  const used = limit - remaining
  const pct = Math.max(0, Math.min(100, Math.round((used / limit) * 100)))
  const fill = document.getElementById(fillId)
  fill.style.width = pct + '%'
  fill.style.background = gaugeColor(pct)
  document.getElementById(pctId).textContent = pct + '% used'
  document.getElementById(pctId).style.color = gaugeColor(pct)
  document.getElementById(remId).textContent = fmtTokens(remaining) + ' remaining'
  if (resetId && resetEpoch) {
    const secs = Math.max(0, Math.round((resetEpoch - Date.now()) / 1000))
    document.getElementById(resetId).textContent = secs > 0 ? 'resets in ' + secs + 's' : 'resetting…'
  }
}

function formatResetCountdown(resetEpoch) {
  const secs = resetEpoch > 0 ? Math.max(0, Math.round((resetEpoch - Date.now()) / 1000)) : 0
  if (secs <= 0) return ''
  if (secs >= 86400) return Math.floor(secs / 86400) + 'd ' + Math.floor((secs % 86400) / 3600) + 'h'
  if (secs >= 3600) return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm'
  if (secs >= 60) return Math.floor(secs / 60) + 'm'
  return secs + 's'
}

function fillPercentGauge(fillId, pctId, remId, resetId, usedPercent, resetEpoch) {
  if (usedPercent == null) {
    document.getElementById(fillId).style.width = '0%'
    document.getElementById(pctId).textContent = 'â€”'
    document.getElementById(remId).textContent = 'â€”'
    if (resetId) document.getElementById(resetId).textContent = ''
    return
  }
  const pct = Math.max(0, Math.min(100, Math.round(usedPercent || 0)))
  const fill = document.getElementById(fillId)
  fill.style.width = pct + '%'
  fill.style.background = gaugeColor(pct)
  document.getElementById(pctId).textContent = pct + '%'
  document.getElementById(pctId).style.color = gaugeColor(pct)
  document.getElementById(remId).textContent = pct >= 80 ? pct + '% used' : (100 - pct) + '% free'
  const resetStr = formatResetCountdown(resetEpoch)
  if (resetId) document.getElementById(resetId).textContent = resetStr ? 'resets in ' + resetStr : ''
}

function renderLimits(d) {
  if (!d) return
  const { anthropic, openai, gemini } = d

  // ── Anthropic ──
  const arl = anthropic?.rl
  const au = anthropic?.usage
  const antHasUsage = au && (au.inputSession > 0 || au.outputSession > 0)
  if (arl?.hasData) {
    document.getElementById('ant-badge').className = 'limits-cli-badge live'
    document.getElementById('ant-badge').textContent = 'live'
    fillGauge('ant-tok-fill','ant-tok-pct','ant-tok-rem','ant-tok-reset', arl.tokensRemaining, arl.tokensLimit, arl.tokensResetEpoch)
    fillGauge('ant-req-fill','ant-req-pct','ant-req-rem','ant-req-reset', arl.requestsRemaining, arl.requestsLimit, arl.requestsResetEpoch)
    fillGauge('ant-inp-fill','ant-inp-pct','ant-inp-rem','ant-inp-reset', arl.inputTokensRemaining, arl.inputTokensLimit, arl.tokensResetEpoch)
    fillGauge('ant-out-fill','ant-out-pct','ant-out-rem','ant-out-reset', arl.outputTokensRemaining, arl.outputTokensLimit, arl.tokensResetEpoch)
  } else if (anthropic?.unified?.hasData) {
    // Subscription (OAuth): unified rate limits with 5h/7d windows
    const u = anthropic.unified
    document.getElementById('ant-badge').className = 'limits-cli-badge live'
    document.getElementById('ant-badge').textContent = 'subscription'
    // Relabel gauges for subscription windows
    document.getElementById('ant-tok-label').textContent = '5-hour window'
    document.getElementById('ant-req-label').textContent = '7-day window'
    document.getElementById('ant-inp-label').textContent = 'Session input'
    document.getElementById('ant-out-label').textContent = 'Session output'
    // 5-hour window
    const pct5h = Math.round(u.fiveHourUtilization * 100)
    document.getElementById('ant-tok-fill').style.width = pct5h + '%'
    document.getElementById('ant-tok-fill').style.background = gaugeColor(pct5h)
    document.getElementById('ant-tok-pct').textContent = pct5h + '%'
    document.getElementById('ant-tok-pct').style.color = gaugeColor(pct5h)
    const secs5h = u.fiveHourResetEpoch > 0 ? Math.max(0, Math.round((u.fiveHourResetEpoch - Date.now()) / 1000)) : 0
    const resetStr5h = secs5h > 3600 ? Math.floor(secs5h/3600) + 'h ' + Math.floor((secs5h%3600)/60) + 'm'
                     : secs5h > 60 ? Math.floor(secs5h/60) + 'm'
                     : secs5h > 0 ? secs5h + 's' : ''
    document.getElementById('ant-tok-rem').textContent = u.fiveHourStatus === 'allowed'
      ? (pct5h >= 80 ? pct5h + '% used' : (100-pct5h) + '% free')
      : 'throttled — resets in ' + resetStr5h
    document.getElementById('ant-tok-reset').textContent = resetStr5h ? 'resets in ' + resetStr5h : ''
    // 7-day window
    const pct7d = Math.round(u.sevenDayUtilization * 100)
    document.getElementById('ant-req-fill').style.width = pct7d + '%'
    document.getElementById('ant-req-fill').style.background = gaugeColor(pct7d)
    document.getElementById('ant-req-pct').textContent = pct7d + '%'
    document.getElementById('ant-req-pct').style.color = gaugeColor(pct7d)
    const secs7d = u.sevenDayResetEpoch > 0 ? Math.max(0, Math.round((u.sevenDayResetEpoch - Date.now()) / 1000)) : 0
    const resetStr7d = secs7d > 86400 ? Math.floor(secs7d/86400) + 'd ' + Math.floor((secs7d%86400)/3600) + 'h'
                     : secs7d > 3600 ? Math.floor(secs7d/3600) + 'h ' + Math.floor((secs7d%3600)/60) + 'm'
                     : secs7d > 0 ? Math.floor(secs7d/60) + 'm' : ''
    document.getElementById('ant-req-rem').textContent = u.sevenDayStatus === 'allowed'
      ? (pct7d >= 80 ? pct7d + '% used' : (100-pct7d) + '% free')
      : 'throttled — resets in ' + resetStr7d
    document.getElementById('ant-req-reset').textContent = resetStr7d ? 'resets in ' + resetStr7d : ''
    // Input/output: show session totals
    document.getElementById('ant-inp-pct').textContent = fmtTokens(au?.inputSession || 0)
    document.getElementById('ant-inp-rem').textContent = 'session input'
    document.getElementById('ant-out-pct').textContent = fmtTokens(au?.outputSession || 0)
    document.getElementById('ant-out-rem').textContent = 'session output'
  } else if (antHasUsage) {
    // Fallback: no rate limit headers at all, but usage is tracked
    document.getElementById('ant-badge').className = 'limits-cli-badge live'
    document.getElementById('ant-badge').textContent = 'tracking'
    document.getElementById('ant-tok-pct').textContent = fmtTokens((au?.inputSession || 0) + (au?.outputSession || 0))
    document.getElementById('ant-tok-rem').textContent = 'session total'
    document.getElementById('ant-req-pct').textContent = (au?.requestsSession || 0) + ' reqs'
    document.getElementById('ant-req-rem').textContent = 'session total'
    document.getElementById('ant-inp-pct').textContent = fmtTokens(au?.inputSession || 0)
    document.getElementById('ant-inp-rem').textContent = 'session input'
    document.getElementById('ant-out-pct').textContent = fmtTokens(au?.outputSession || 0)
    document.getElementById('ant-out-rem').textContent = 'session output'
  }
  if (au) {
    document.getElementById('ant-u-inp-s').textContent = fmtTokens(au.inputSession)
    document.getElementById('ant-u-out-s').textContent = fmtTokens(au.outputSession)
    document.getElementById('ant-u-inp-d').textContent = fmtTokens(au.inputToday)
    document.getElementById('ant-u-out-d').textContent = fmtTokens(au.outputToday)
  }

  // ── OpenAI ──
  const os = openai?.session
  const orl = openai?.rl
  const ou = openai?.usage
  const oaiHasUsage = ou && (ou.inputSession > 0 || ou.outputSession > 0)
  if (os?.hasData) {
    document.getElementById('oai-badge').className = 'limits-cli-badge live'
    document.getElementById('oai-badge').textContent = os.planType || 'session'
    document.getElementById('oai-tok-label').textContent = (os.primary?.windowDurationMins || 300) >= 300 ? '5-hour window' : 'session window'
    document.getElementById('oai-req-label').textContent = (os.secondary?.windowDurationMins || 0) >= 10080 ? '7-day window' : 'weekly window'
    fillPercentGauge('oai-tok-fill','oai-tok-pct','oai-tok-rem','oai-tok-reset', os.primary?.usedPercent, os.primary?.resetsAt || 0)
    fillPercentGauge('oai-req-fill','oai-req-pct','oai-req-rem','oai-req-reset', os.secondary?.usedPercent, os.secondary?.resetsAt || 0)
  } else if (orl?.hasData) {
    document.getElementById('oai-badge').className = 'limits-cli-badge live'
    document.getElementById('oai-badge').textContent = 'live'
    document.getElementById('oai-tok-label').textContent = 'tokens / minute'
    document.getElementById('oai-req-label').textContent = 'requests / minute'
    fillGauge('oai-tok-fill','oai-tok-pct','oai-tok-rem','oai-tok-reset', orl.tokensRemaining, orl.tokensLimit, orl.tokensResetEpoch)
    fillGauge('oai-req-fill','oai-req-pct','oai-req-rem','oai-req-reset', orl.requestsRemaining, orl.requestsLimit, orl.requestsResetEpoch)
  } else if (oaiHasUsage) {
    document.getElementById('oai-badge').className = 'limits-cli-badge live'
    document.getElementById('oai-badge').textContent = 'tracking'
    document.getElementById('oai-tok-label').textContent = 'session total'
    document.getElementById('oai-req-label').textContent = 'session requests'
    document.getElementById('oai-tok-pct').textContent = fmtTokens(ou.inputSession + ou.outputSession)
    document.getElementById('oai-tok-rem').textContent = 'session total'
    document.getElementById('oai-req-pct').textContent = ou.requestsSession + ' reqs'
    document.getElementById('oai-req-rem').textContent = 'session total'
  }
  const ob = openai?.billing
  if (ob?.hardLimitUsd > 0) {
    document.getElementById('oai-billing-row').style.display = 'flex'
    document.getElementById('oai-credits').textContent = '$' + (ob.creditBalanceUsd || 0).toFixed(2)
    document.getElementById('oai-hard-lim').textContent = '$' + ob.hardLimitUsd.toFixed(2)
  }
  if (ou) {
    document.getElementById('oai-u-inp-s').textContent = fmtTokens(ou.inputSession)
    document.getElementById('oai-u-out-s').textContent = fmtTokens(ou.outputSession)
    document.getElementById('oai-u-inp-d').textContent = fmtTokens(ou.inputToday)
    document.getElementById('oai-u-out-d').textContent = fmtTokens(ou.outputToday)
  }

  // ── Gemini ──
  const ge = gemini?.errors
  const gu = gemini?.usage
  const gemHasUsage = gu && (gu.inputSession > 0 || gu.outputSession > 0)
  if (ge?.hasData) {
    document.getElementById('gem-nodata').style.display = 'none'
    document.getElementById('gem-data').style.display = 'block'
    document.getElementById('gem-tok-lim').textContent = fmtTokens(gemini.rl?.tokensLimit)
    document.getElementById('gem-errors').textContent = ge.errorCount429 + ' rate-limit errors'
    document.getElementById('gem-badge').className = 'limits-cli-badge error'
    document.getElementById('gem-badge').textContent = ge.errorCount429 + ' 429 errors'
  } else if (gemHasUsage) {
    document.getElementById('gem-nodata').style.display = 'none'
    document.getElementById('gem-data').style.display = 'block'
    document.getElementById('gem-badge').className = 'limits-cli-badge live'
    document.getElementById('gem-badge').textContent = 'tracking'
  }
  if (gu) {
    document.getElementById('gem-u-inp-s').textContent = fmtTokens(gu.inputSession)
    document.getElementById('gem-u-out-s').textContent = fmtTokens(gu.outputSession)
    document.getElementById('gem-u-inp-d').textContent = fmtTokens(gu.inputToday)
    document.getElementById('gem-u-out-d').textContent = fmtTokens(gu.outputToday)
  }

  // ── Budget ──
  updateBudgetBar(au, ou, gu)
}

// Countdown ticker — updates reset countdowns every second without SSE
function startLimitsCountdown(limitsData) {
  if (limitsCountdownTimer) clearInterval(limitsCountdownTimer)
  limitsCountdownTimer = setInterval(() => {
    const updateReset = (id, resetEpoch) => {
      if (!resetEpoch) return
      const el = document.getElementById(id)
      if (!el) return
      const secs = Math.max(0, Math.round((resetEpoch - Date.now()) / 1000))
      el.textContent = secs > 0 ? 'resets in ' + secs + 's' : 'resetting…'
    }
    const d = limitsData
    if (d?.anthropic?.rl?.hasData) {
      updateReset('ant-tok-reset', d.anthropic.rl.tokensResetEpoch)
      updateReset('ant-req-reset', d.anthropic.rl.requestsResetEpoch)
      updateReset('ant-inp-reset', d.anthropic.rl.tokensResetEpoch)
      updateReset('ant-out-reset', d.anthropic.rl.tokensResetEpoch)
    }
    if (d?.openai?.rl?.hasData) {
      updateReset('oai-tok-reset', d.openai.rl.tokensResetEpoch)
      updateReset('oai-req-reset', d.openai.rl.requestsResetEpoch)
    }
    if (d?.openai?.session?.hasData) {
      const tok = d.openai.session.primary?.resetsAt || 0
      const req = d.openai.session.secondary?.resetsAt || 0
      updateReset('oai-tok-reset', tok)
      updateReset('oai-req-reset', req)
    }
  }, 1000)
}

// ── Budget logic ─────────────────────────────────────────────────────────────
let dailyBudget = parseInt(localStorage.getItem('squeezr_budget') || '0')

function updateBudgetBar(au, ou, gu) {
  const budget = dailyBudget
  const budgetInput = document.getElementById('budget-input')
  if (budgetInput && !budgetInput.value) budgetInput.value = budget || ''

  const wrap = document.getElementById('budget-bar-wrap')
  if (!budget) { wrap.style.display = 'none'; return }
  wrap.style.display = 'block'

  const totalToday = ((au?.inputToday || 0) + (au?.outputToday || 0) +
                      (ou?.inputToday || 0) + (ou?.outputToday || 0) +
                      (gu?.inputToday || 0) + (gu?.outputToday || 0))
  const pct = Math.min(100, Math.round((totalToday / budget) * 100))
  const fill = document.getElementById('budget-bar')
  fill.style.width = pct + '%'
  fill.style.background = gaugeColor(pct)
  document.getElementById('budget-pct-label').textContent = pct + '%'
  document.getElementById('budget-pct-label').style.color = gaugeColor(pct)
  document.getElementById('budget-used-label').textContent = fmtTokens(totalToday) + ' used today'
  document.getElementById('budget-limit-label').textContent = 'of ' + fmtTokens(budget) + ' / day'
}

document.getElementById('budget-save').addEventListener('click', () => {
  const val = parseInt(document.getElementById('budget-input').value || '0')
  dailyBudget = val
  localStorage.setItem('squeezr_budget', String(val))
  document.getElementById('budget-save').textContent = '✓ Saved'
  setTimeout(() => document.getElementById('budget-save').textContent = 'Save', 2000)
  // Re-render budget bar with latest limits data
  if (lastLimitsData) {
    const u = lastLimitsData.usage
    updateBudgetBar(u?.anthropic, u?.openai, u?.gemini)
  }
})

// Restore budget from localStorage on load
const savedBudget = localStorage.getItem('squeezr_budget')
if (savedBudget) document.getElementById('budget-input').value = savedBudget

// ── Navigation ────────────────────────────────────────────────────────────────
const pageTitles = { overview: 'Overview', projects: 'Projects', history: 'History', limits: 'Limits', settings: 'Settings' }

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
    if (page === 'limits') {
      if (lastLimitsData) {
        renderLimits(lastLimitsData)
        startLimitsCountdown(lastLimitsData)
      }
    }
    if (page !== 'limits' && limitsCountdownTimer) {
      clearInterval(limitsCountdownTimer)
      limitsCountdownTimer = null
    }
  })
})

// ── Mode selector ─────────────────────────────────────────────────────────────
document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.mode
    if (!mode) return
    const prevActive = document.querySelector('.mode-btn.active')
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    try {
      const res = await fetch('/squeezr/config', {
        method: 'POST',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({ mode })
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
    } catch(e) {
      // Revert to previous mode on failure
      btn.classList.remove('active')
      if (prevActive) prevActive.classList.add('active')
      console.error('mode update failed', e)
    }
  })
})

// ── SSE ───────────────────────────────────────────────────────────────────────
const dot = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')
const connPill = document.getElementById('conn-pill')
const connStatus = document.getElementById('conn-status')
let lastLimitsData = null

function connect() {
  const es = new EventSource('/squeezr/events')
  es.onmessage = e => {
    try {
      const d = JSON.parse(e.data)
      renderOverview(d)
      if (d.limits) {
        lastLimitsData = d.limits
        // Only render limits page if it's currently visible
        const limPage = document.getElementById('page-limits')
        if (limPage && limPage.classList.contains('active')) {
          renderLimits(d.limits)
          if (!limitsCountdownTimer) startLimitsCountdown(d.limits)
          else { /* update the data reference for the countdown */ lastLimitsData = d.limits }
        }
      }
    } catch(err) { console.error(err) }
  }
  es.onopen = () => {
    dot.classList.remove('off')
    statusText.textContent = 'Connected'
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
