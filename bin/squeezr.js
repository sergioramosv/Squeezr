#!/usr/bin/env node

import { spawn, execSync } from 'child_process'
import http from 'http'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const ROOT = path.join(__dirname, '..')
const pkg = require(path.join(ROOT, 'package.json'))

const args = process.argv.slice(2)
const command = args[0]

const HELP = `
Squeezr v${pkg.version} — AI context compressor for Claude Code, Codex, Aider, Gemini CLI and Ollama

Usage:
  squeezr                  Start the proxy (default)
  squeezr start            Start the proxy
  squeezr setup            One-time setup: auto-start on login + configure all CLIs
  squeezr stop             Stop the running proxy
  squeezr logs             Show last 50 lines of the log file
  squeezr gain             Show token savings stats
  squeezr gain --reset     Reset saved stats
  squeezr discover         Show pattern coverage report (proxy must be running)
  squeezr status           Check if proxy is running
  squeezr config           Print config file path and current settings
  squeezr version          Print version
  squeezr help             Show this help
`

function runNode(script, extraArgs = []) {
  const distPath = path.join(ROOT, 'dist', script)
  if (!fs.existsSync(distPath)) {
    console.error(`Error: ${distPath} not found. Run 'npm run build' first.`)
    process.exit(1)
  }
  const child = spawn(process.execPath, [distPath, ...extraArgs], {
    stdio: 'inherit',
    cwd: ROOT,
  })
  child.on('exit', code => process.exit(code ?? 0))
}

function showLogs() {
  const logFile = path.join(os.homedir(), '.squeezr', 'squeezr.log')
  if (!fs.existsSync(logFile)) {
    console.log('No log file yet. Run: squeezr setup')
    return
  }
  // Show last 50 lines
  const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean)
  const tail = lines.slice(-50)
  if (tail.length === 0) {
    console.log('Log file is empty — no requests yet.')
    return
  }
  console.log(`=== ${logFile} (last ${tail.length} lines) ===\n`)
  console.log(tail.join('\n'))
}

function stopProxy() {
  const port = process.env.SQUEEZR_PORT || 8080
  try {
    let pid
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr ":${port} "`, { encoding: 'utf-8', stdio: 'pipe' })
      const match = out.match(/LISTENING\s+(\d+)/)
      pid = match?.[1]
    } else {
      pid = execSync(`lsof -ti :${port}`, { encoding: 'utf-8', stdio: 'pipe' }).trim()
    }
    if (!pid) {
      console.log(`Squeezr is not running on port ${port}`)
      return
    }
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' })
    } else {
      execSync(`kill ${pid}`, { stdio: 'pipe' })
    }
    console.log(`Squeezr stopped (pid ${pid})`)
  } catch {
    console.log(`Squeezr is not running on port ${port}`)
  }
}

async function checkStatus() {
  const port = process.env.SQUEEZR_PORT || 8080
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/squeezr/health`, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          console.log(`Squeezr is running  (v${json.version} on port ${port})`)
        } catch {
          console.log(`Squeezr is running on port ${port}`)
        }
        resolve(true)
      })
    })
    req.on('error', () => {
      console.log(`Squeezr is NOT running on port ${port}`)
      console.log('Start it with: squeezr start')
      resolve(false)
    })
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function showConfig() {
  const tomlPath = path.join(ROOT, 'squeezr.toml')
  console.log(`Config file: ${tomlPath}`)
  if (fs.existsSync(tomlPath)) {
    console.log('\nCurrent config:')
    console.log(fs.readFileSync(tomlPath, 'utf-8'))
  } else {
    console.log('No squeezr.toml found. Using defaults.')
  }
}

// ── squeezr setup ─────────────────────────────────────────────────────────────

function setupWindows() {
  const squeezrBin = process.argv[1]
  const nodeExe = process.execPath
  const distIndex = path.join(ROOT, 'dist', 'index.js')

  console.log('Setting up Squeezr for Windows...\n')

  // 1. Set env vars permanently via setx (user scope, no admin needed)
  const vars = {
    ANTHROPIC_BASE_URL: 'http://localhost:8080',
    OPENAI_BASE_URL: 'http://localhost:8080',
    GEMINI_API_BASE_URL: 'http://localhost:8080',
  }
  for (const [key, value] of Object.entries(vars)) {
    try {
      execSync(`setx ${key} "${value}"`, { stdio: 'pipe' })
      console.log(`  [ok] ${key}=${value}`)
    } catch {
      console.log(`  [skip] ${key} could not be set`)
    }
  }

  // 2. Register Task Scheduler with hidden window so no console pops up on login.
  // The action runs: powershell -WindowStyle Hidden -Command "node dist/index.js"
  const taskName = 'Squeezr'
  const nodeArg = `${nodeExe} \`"${distIndex}\`"`
  const ps = [
    `$e = Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue`,
    `if ($e) { Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false }`,
    `$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-WindowStyle Hidden -NonInteractive -Command "${nodeArg}"' -WorkingDirectory '${ROOT}'`,
    `$t = New-ScheduledTaskTrigger -AtLogon`,
    `$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)`,
    `Register-ScheduledTask -TaskName '${taskName}' -Action $a -Trigger $t -Settings $s -RunLevel Highest -Force | Out-Null`,
  ].join('; ')

  try {
    execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'pipe' })
    console.log(`  [ok] Auto-start registered in Task Scheduler (hidden, starts on login)`)
  } catch {
    console.log(`  [warn] Task Scheduler failed — run as admin for auto-start on login`)
  }

  // 3. Start Squeezr right now as a detached background process (no window)
  //    Logs go to ~/.squeezr/squeezr.log
  const logDir = path.join(os.homedir(), '.squeezr')
  const logFile = path.join(logDir, 'squeezr.log')
  fs.mkdirSync(logDir, { recursive: true })
  const logFd = fs.openSync(logFile, 'a')
  const child = spawn(nodeExe, [distIndex], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    cwd: ROOT,
  })
  child.unref()
  fs.closeSync(logFd)
  console.log(`  [ok] Squeezr started in background (pid ${child.pid})`)
  console.log(`  [ok] Logs → ${logFile}`)

  console.log(`
Done!

  Squeezr is running on http://localhost:8080
  All CLIs (Claude Code, Codex, Aider, Gemini, Ollama) are configured.

  Restart your terminal and Claude Code once for the env vars to take effect.
  After that, everything is automatic — Squeezr starts silently on every login.

  squeezr status   — check it's running
  squeezr gain     — see token savings
`)
}

function setupUnix() {
  const squeezrBin = process.argv[1]
  const nodeExe = process.execPath
  const platform = process.platform

  console.log(`Setting up Squeezr for ${platform === 'darwin' ? 'macOS' : 'Linux'}...\n`)

  // 1. Set env vars in shell profile
  const exportLines = [
    'export ANTHROPIC_BASE_URL=http://localhost:8080',
    'export OPENAI_BASE_URL=http://localhost:8080',
    'export GEMINI_API_BASE_URL=http://localhost:8080',
  ]
  const marker = '# squeezr env vars'
  const profiles = [
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.bash_profile'),
  ]
  const profile = profiles.find(p => fs.existsSync(p)) ?? profiles[0]
  const existing = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf-8') : ''
  if (!existing.includes(marker)) {
    fs.appendFileSync(profile, `\n${marker}\n${exportLines.join('\n')}\n`)
    console.log(`  [ok] Env vars added to ${profile}`)
  } else {
    console.log(`  [skip] Env vars already in ${profile}`)
  }

  // 2a. macOS — launchd
  if (platform === 'darwin') {
    const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents')
    const plistPath = path.join(plistDir, 'com.squeezr.plist')
    fs.mkdirSync(plistDir, { recursive: true })
    fs.writeFileSync(plistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.squeezr</string>
  <key>ProgramArguments</key>
  <array><string>${nodeExe}</string><string>${squeezrBin}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${os.homedir()}/.squeezr/squeezr.log</string>
  <key>StandardErrorPath</key><string>${os.homedir()}/.squeezr/squeezr.log</string>
</dict>
</plist>`)
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null; launchctl load "${plistPath}"`, { stdio: 'pipe' })
      console.log(`  [ok] Auto-start registered via launchd`)
      console.log(`  [ok] Squeezr started now`)
    } catch {
      console.log(`  [warn] launchctl failed — starting in background`)
      spawn(nodeExe, [squeezrBin], { detached: true, stdio: 'ignore' }).unref()
    }

  // 2b. Linux — systemd
  } else {
    const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user')
    const servicePath = path.join(serviceDir, 'squeezr.service')
    fs.mkdirSync(serviceDir, { recursive: true })
    fs.writeFileSync(servicePath, `[Unit]
Description=Squeezr AI proxy
After=network.target

[Service]
ExecStart=${nodeExe} ${squeezrBin}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`)
    try {
      execSync('systemctl --user daemon-reload && systemctl --user enable --now squeezr', { stdio: 'pipe' })
      console.log(`  [ok] Auto-start registered via systemd`)
      console.log(`  [ok] Squeezr started now`)
    } catch {
      console.log(`  [warn] systemctl failed — starting in background`)
      spawn(nodeExe, [squeezrBin], { detached: true, stdio: 'ignore' }).unref()
    }
  }

  console.log(`
Done!

  Squeezr is running on http://localhost:8080
  All CLIs (Claude Code, Codex, Aider, Gemini, Ollama) are configured.

  Run: source ${profile}  (or open a new terminal)
  After that, everything is automatic.

  squeezr status   — check it's running
  squeezr gain     — see token savings
`)
}

// ── CLI router ────────────────────────────────────────────────────────────────

switch (command) {
  case undefined:
  case 'start':
    runNode('index.js')
    break

  case 'setup':
    if (process.platform === 'win32') setupWindows()
    else setupUnix()
    break

  case 'stop':
    stopProxy()
    break

  case 'logs':
    showLogs()
    break

  case 'gain':
    runNode('gain.js', args.slice(1))
    break

  case 'discover':
    runNode('discover.js', args.slice(1))
    break

  case 'status':
    checkStatus()
    break

  case 'config':
    showConfig()
    break

  case 'version':
  case '--version':
  case '-v':
    console.log(pkg.version)
    break

  case '--help':
  case '-h':
  case 'help':
    console.log(HELP)
    break

  default:
    console.error(`Unknown command: ${command}`)
    console.log(HELP)
    process.exit(1)
}
