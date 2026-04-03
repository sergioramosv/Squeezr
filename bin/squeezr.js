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

function getMitmPort(port) {
  const envMitm = process.env.SQUEEZR_MITM_PORT
  if (envMitm) return parseInt(envMitm)
  try {
    const toml = fs.readFileSync(path.join(ROOT, 'squeezr.toml'), 'utf-8')
    const m = toml.match(/^mitm_port\s*=\s*(\d+)/m)
    if (m) return parseInt(m[1])
  } catch {}
  return Number(port) + 1
}

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
  squeezr ports            Change HTTP and MITM proxy ports
  squeezr uninstall        Remove Squeezr completely (env vars, CA, auto-start, logs)
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

async function startDaemon() {
  const distIndex = path.join(ROOT, 'dist', 'index.js')
  if (!fs.existsSync(distIndex)) {
    console.error(`Error: ${distIndex} not found. Run 'npm run build' first.`)
    process.exit(1)
  }

  // Check if already running — and if the version matches
  const port = process.env.SQUEEZR_PORT || 8080
  const runningVersion = await new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/squeezr/health`, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data).version) } catch { resolve('unknown') }
      })
    })
    req.on('error', () => resolve(null))
    req.setTimeout(2000, () => { req.destroy(); resolve(null) })
  })
  if (runningVersion) {
    if (runningVersion === pkg.version) {
      const mitmPort = getMitmPort(port)
      console.log(`Squeezr is already running (v${pkg.version})`)
      console.log(`  HTTP proxy (Claude/Aider/Gemini): http://localhost:${port}`)
      console.log(`  MITM proxy (Codex):               http://localhost:${mitmPort}`)
      return
    }
    // Version mismatch — old process from before npm update. Kill and restart.
    console.log(`Squeezr v${runningVersion} is running but v${pkg.version} is installed. Restarting...`)
    stopProxy()
    // Wait for ports to free up
    await new Promise(r => setTimeout(r, 1500))
  }

  // Launch detached background process
  const logDir = path.join(os.homedir(), '.squeezr')
  const logFile = path.join(logDir, 'squeezr.log')
  fs.mkdirSync(logDir, { recursive: true })
  const logFd = fs.openSync(logFile, 'a')
  const child = spawn(process.execPath, [distIndex], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    cwd: ROOT,
    env: { ...process.env, SQUEEZR_DAEMON: '1' },
  })
  child.unref()
  fs.closeSync(logFd)
  const mitmPort = getMitmPort(port)
  console.log(`Squeezr started (pid ${child.pid})`)
  console.log(`  HTTP proxy (Claude/Aider/Gemini): http://localhost:${port}`)
  console.log(`  MITM proxy (Codex):               http://localhost:${mitmPort}`)
  console.log(`  Logs: ${logFile}`)
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
  const mitmPort = getMitmPort(port)
  const ports = [port, mitmPort]
  let killed = false

  for (const p of ports) {
    try {
      let pids = []
      if (process.platform === 'win32') {
        const out = execSync(`netstat -ano | findstr ":${p} "`, { encoding: 'utf-8', stdio: 'pipe' })
        const matches = [...out.matchAll(/LISTENING\s+(\d+)/g)]
        pids = [...new Set(matches.map(m => m[1]))]
      } else {
        try {
          const out = execSync(`lsof -ti :${p} -sTCP:LISTEN`, { encoding: 'utf-8', stdio: 'pipe' }).trim()
          pids = out.split(/\s+/).filter(Boolean)
        } catch {
          try {
            const out = execSync(`fuser ${p}/tcp 2>/dev/null`, { encoding: 'utf-8', stdio: 'pipe' }).trim()
            pids = out.split(/\s+/).filter(Boolean)
          } catch {}
        }
      }
      for (const pid of pids) {
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' })
          } else {
            execSync(`kill -9 ${pid}`, { stdio: 'pipe' })
          }
          console.log(`Squeezr stopped (pid ${pid} on port ${p})`)
          killed = true
        } catch {}
      }
    } catch {}
  }
  if (!killed) {
    console.log(`Squeezr is not running on port ${port}`)
  }
}

async function checkStatus() {
  const port = process.env.SQUEEZR_PORT || 8080
  const mitmPort = getMitmPort(port)
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${port}/squeezr/health`, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          console.log(`Squeezr is running  (v${json.version})`)
          console.log(`  HTTP proxy (Claude/Aider/Gemini): http://localhost:${port}`)
          console.log(`  MITM proxy (Codex):               http://localhost:${mitmPort}`)
        } catch {
          console.log(`Squeezr is running on port ${port}`)
        }
        resolve(true)
      })
    })
    req.on('error', () => {
      console.log(`Squeezr is NOT running`)
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

// ── squeezr ports ─────────────────────────────────────────────────────────────

async function configurePorts() {
  const { createInterface } = await import('readline')
  const tomlPath = path.join(ROOT, 'squeezr.toml')
  let tomlContent = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath, 'utf-8') : ''

  // Read current ports from toml
  const portMatch = tomlContent.match(/^port\s*=\s*(\d+)/m)
  const mitmMatch = tomlContent.match(/^mitm_port\s*=\s*(\d+)/m)
  const currentPort = portMatch ? parseInt(portMatch[1]) : 8080
  const currentMitm = mitmMatch ? parseInt(mitmMatch[1]) : currentPort + 1

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q) => new Promise(resolve => rl.question(q, resolve))

  console.log(`\nCurrent ports:`)
  console.log(`  HTTP proxy (Claude/Aider/Gemini): ${currentPort}`)
  console.log(`  MITM proxy (Codex):               ${currentMitm}\n`)

  const newPort = await ask(`HTTP proxy port [${currentPort}]: `)
  const newMitm = await ask(`MITM proxy port [${currentMitm}]: `)
  rl.close()

  const finalPort = newPort.trim() ? parseInt(newPort.trim()) : currentPort
  const finalMitm = newMitm.trim() ? parseInt(newMitm.trim()) : currentMitm

  if (isNaN(finalPort) || isNaN(finalMitm) || finalPort < 1 || finalMitm < 1 || finalPort > 65535 || finalMitm > 65535) {
    console.error('Invalid port number. Must be between 1 and 65535.')
    process.exit(1)
  }
  if (finalPort === finalMitm) {
    console.error('HTTP and MITM ports must be different.')
    process.exit(1)
  }

  // Update toml
  if (portMatch) {
    tomlContent = tomlContent.replace(/^port\s*=\s*\d+/m, `port = ${finalPort}`)
  } else if (tomlContent.includes('[proxy]')) {
    tomlContent = tomlContent.replace('[proxy]', `[proxy]\nport = ${finalPort}`)
  } else {
    tomlContent = `[proxy]\nport = ${finalPort}\n` + tomlContent
  }

  if (mitmMatch) {
    tomlContent = tomlContent.replace(/^mitm_port\s*=\s*\d+/m, `mitm_port = ${finalMitm}`)
  } else {
    // Add after port line
    tomlContent = tomlContent.replace(/^(port\s*=\s*\d+)/m, `$1\nmitm_port = ${finalMitm}`)
  }

  fs.writeFileSync(tomlPath, tomlContent)
  console.log(`\nSaved to ${tomlPath}`)

  // Update env vars
  if (process.platform === 'win32') {
    try { execSync(`setx SQUEEZR_PORT "${finalPort}"`, { stdio: 'pipe' }) } catch {}
    try { execSync(`setx SQUEEZR_MITM_PORT "${finalMitm}"`, { stdio: 'pipe' }) } catch {}
    try { execSync(`setx ANTHROPIC_BASE_URL "http://localhost:${finalPort}"`, { stdio: 'pipe' }) } catch {}
    try { execSync(`setx GEMINI_API_BASE_URL "http://localhost:${finalPort}"`, { stdio: 'pipe' }) } catch {}
    try { execSync(`setx HTTPS_PROXY "http://localhost:${finalMitm}"`, { stdio: 'pipe' }) } catch {}
    console.log('Environment variables updated. Restart your terminal for changes to take effect.')
  } else {
    console.log(`\nUpdate your shell profile:`)
    console.log(`  export SQUEEZR_PORT=${finalPort}`)
    console.log(`  export SQUEEZR_MITM_PORT=${finalMitm}`)
    console.log(`  export ANTHROPIC_BASE_URL=http://localhost:${finalPort}`)
    console.log(`  export HTTPS_PROXY=http://localhost:${finalMitm}`)
  }

  console.log(`\nRestart squeezr for changes to take effect:`)
  console.log(`  squeezr stop && squeezr start`)
}

// ── squeezr uninstall ─────────────────────────────────────────────────────────

async function uninstall() {
  const { createInterface } = await import('readline')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolve => rl.question(
    'This will remove Squeezr completely: stop proxy, remove env vars, CA certs, auto-start, config, and logs.\nContinue? [y/N] ', resolve
  ))
  rl.close()
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('Cancelled.')
    return
  }

  console.log('\nUninstalling Squeezr...\n')

  // 1. Stop proxy
  stopProxy()

  // 2. Remove env vars
  if (process.platform === 'win32') {
    const vars = ['ANTHROPIC_BASE_URL', 'GEMINI_API_BASE_URL', 'HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS', 'SQUEEZR_PORT', 'SQUEEZR_MITM_PORT', 'openai_base_url', 'NO_PROXY']
    for (const v of vars) {
      try { execSync(`reg delete "HKCU\\Environment" /v ${v} /f`, { stdio: 'pipe' }) } catch {}
    }
    console.log('  [ok] Windows env vars removed')
  } else {
    // Remove squeezr block from shell profiles
    const profiles = [
      path.join(os.homedir(), '.zshrc'),
      path.join(os.homedir(), '.bashrc'),
      path.join(os.homedir(), '.bash_profile'),
    ]
    for (const p of profiles) {
      try {
        const content = fs.readFileSync(p, 'utf-8')
        if (content.includes('# squeezr env vars')) {
          const cleaned = content.replace(/\n?# squeezr env vars[\s\S]*?fi\n?/g, '\n')
          fs.writeFileSync(p, cleaned)
          console.log(`  [ok] Cleaned ${p}`)
        }
      } catch {}
    }
  }

  // 3. Remove CA from certificate stores
  if (process.platform === 'win32') {
    try { execSync('certutil -delstore -user Root "Squeezr-MITM-CA"', { stdio: 'pipe' }); console.log('  [ok] CA removed from user certificate store') } catch {}
    try { execSync('certutil -delstore Root "Squeezr-MITM-CA"', { stdio: 'pipe' }) } catch {}
  } else if (process.platform === 'darwin') {
    try { execSync('security delete-certificate -c "Squeezr-MITM-CA" ~/Library/Keychains/login.keychain-db', { stdio: 'pipe' }); console.log('  [ok] CA removed from Keychain') } catch {}
  }
  // On Linux, CA is only in bundle.crt which gets deleted with ~/.squeezr below

  // 4. Remove auto-start
  if (process.platform === 'win32') {
    try { execSync('nssm stop SqueezrProxy', { stdio: 'pipe' }) } catch {}
    try { execSync('nssm remove SqueezrProxy confirm', { stdio: 'pipe' }) } catch {}
    try { execSync('schtasks /Delete /TN "Squeezr" /F', { stdio: 'pipe' }); console.log('  [ok] Removed scheduled task') } catch {}
  } else if (process.platform === 'darwin') {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.squeezr.plist')
    try { execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' }) } catch {}
    try { fs.unlinkSync(plistPath); console.log('  [ok] Removed launchd plist') } catch {}
  } else {
    try { execSync('systemctl --user disable --now squeezr', { stdio: 'pipe' }) } catch {}
    const servicePath = path.join(os.homedir(), '.config', 'systemd', 'user', 'squeezr.service')
    try { fs.unlinkSync(servicePath); console.log('  [ok] Removed systemd service') } catch {}
  }

  // 5. Remove ~/.squeezr (logs, cache, CA, stats)
  const squeezrDir = path.join(os.homedir(), '.squeezr')
  try {
    fs.rmSync(squeezrDir, { recursive: true, force: true })
    console.log(`  [ok] Removed ${squeezrDir}`)
  } catch {}

  // 6. Remove global config
  const tomlPath = path.join(ROOT, 'squeezr.toml')
  try { fs.unlinkSync(tomlPath) } catch {}

  console.log(`
Done! Squeezr has been completely removed.

To finish, run:
  npm uninstall -g squeezr-ai
`)
}

// ── squeezr setup ─────────────────────────────────────────────────────────────

function setupWindows() {
  const squeezrBin = process.argv[1]
  const nodeExe = process.execPath
  const distIndex = path.join(ROOT, 'dist', 'index.js')

  console.log('Setting up Squeezr for Windows...\n')

  // 1. Set env vars permanently via setx (user scope, no admin needed)
  const port = process.env.SQUEEZR_PORT || 8080
  const mitmPort = getMitmPort(port)
  const caPath = path.join(os.homedir(), '.squeezr', 'mitm-ca', 'ca.crt')
  const vars = {
    ANTHROPIC_BASE_URL: `http://localhost:${port}`,
    // openai_base_url NOT set — Codex uses WebSocket and must go via HTTPS_PROXY/MITM,
    // not through the HTTP proxy. Setting it breaks Codex's ws:// connections.
    GEMINI_API_BASE_URL: `http://localhost:${port}`,
    HTTPS_PROXY: `http://localhost:${mitmPort}`,
    NODE_EXTRA_CA_CERTS: caPath,
    // NO_PROXY not needed — the MITM proxy only intercepts chatgpt.com,
    // all other domains get a transparent TCP tunnel (no TLS termination).
  }
  for (const [key, value] of Object.entries(vars)) {
    try {
      execSync(`setx ${key} "${value}"`, { stdio: 'pipe' })
      console.log(`  [ok] ${key}=${value}`)
    } catch {
      console.log(`  [skip] ${key} could not be set`)
    }
  }

  // 2. Auto-start: try NSSM (Windows service, survives crashes) → fallback to Task Scheduler
  const logDir = path.join(os.homedir(), '.squeezr')
  const serviceName = 'SqueezrProxy'
  let autoStartOk = false

  const nssmAvailable = (() => {
    try { execSync('where nssm', { stdio: 'pipe' }); return true } catch { return false }
  })()

  if (nssmAvailable) {
    try {
      // Remove existing service if present (ignore errors)
      try { execSync(`nssm stop ${serviceName}`, { stdio: 'pipe' }) } catch {}
      try { execSync(`nssm remove ${serviceName} confirm`, { stdio: 'pipe' }) } catch {}

      execSync(`nssm install ${serviceName} "${nodeExe}" "${distIndex}"`, { stdio: 'pipe' })
      execSync(`nssm set ${serviceName} AppDirectory "${ROOT}"`, { stdio: 'pipe' })
      execSync(`nssm set ${serviceName} AppStdout "${logDir}\\service-stdout.log"`, { stdio: 'pipe' })
      execSync(`nssm set ${serviceName} AppStderr "${logDir}\\service-stderr.log"`, { stdio: 'pipe' })
      execSync(`nssm set ${serviceName} AppRotateFiles 1`, { stdio: 'pipe' })
      execSync(`nssm set ${serviceName} AppRotateSeconds 86400`, { stdio: 'pipe' })
      execSync(`nssm set ${serviceName} AppExit Default Restart`, { stdio: 'pipe' })
      execSync(`nssm set ${serviceName} AppRestartDelay 3000`, { stdio: 'pipe' })
      execSync(`nssm set ${serviceName} Description "Squeezr AI token compression proxy on port 8080"`, { stdio: 'pipe' })
      execSync(`nssm start ${serviceName}`, { stdio: 'pipe' })
      console.log(`  [ok] Auto-start registered as Windows service via NSSM (auto-restart on crash)`)
      autoStartOk = true
    } catch (err) {
      const msg = err.stderr?.toString() || err.message || ''
      if (msg.includes('Access') || msg.includes('admin') || msg.includes('5')) {
        console.log(`  [warn] NSSM requires admin — run as Administrator for service install`)
      } else {
        console.log(`  [warn] NSSM install failed: ${msg.trim().split('\n')[0]}`)
      }
    }
  }

  if (!autoStartOk) {
    // Fallback: Task Scheduler (no crash recovery, but no admin needed for user tasks)
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
      console.log(`  [ok] Auto-start registered in Task Scheduler (install NSSM for crash recovery)`)
    } catch {
      console.log(`  [warn] Auto-start failed — install NSSM or run as admin: https://nssm.cc`)
    }
  }

  // 3. Start Squeezr right now as a detached background process (no window)
  //    Logs go to ~/.squeezr/squeezr.log
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

  // 4. Trust MITM CA in Windows Certificate Store (for Rust apps like Codex)
  //    Node.js apps use NODE_EXTRA_CA_CERTS; Rust/native apps need the cert store.
  //    The CA is generated on first proxy start — wait briefly for it to appear.
  const waitForCa = (retries = 10, interval = 500) => new Promise(resolve => {
    const check = (n) => {
      if (fs.existsSync(caPath)) return resolve(true)
      if (n <= 0) return resolve(false)
      setTimeout(() => check(n - 1), interval)
    }
    check(retries)
  })

  waitForCa().then(found => {
    if (!found) {
      console.log(`  [warn] MITM CA not found yet — run 'squeezr setup' again after first start`)
      printDone()
      return
    }
    // Try machine store (admin) first, fall back to user store (no admin)
    try {
      execSync(`certutil -addstore -f Root "${caPath}"`, { stdio: 'pipe' })
      console.log(`  [ok] MITM CA trusted in Windows Certificate Store (machine-level)`)
    } catch {
      try {
        execSync(`certutil -addstore -user Root "${caPath}"`, { stdio: 'pipe' })
        console.log(`  [ok] MITM CA trusted in Windows Certificate Store (user-level)`)
      } catch {
        console.log(`  [warn] Could not trust MITM CA — trust manually:`)
        console.log(`         certutil -addstore -user Root "${caPath}"`)
      }
    }
    printDone()
  })

  function printDone() {
    console.log(`
Done!

  Squeezr is running on http://localhost:${port}
  MITM proxy on http://localhost:${mitmPort} (Codex TLS interception)
  All CLIs (Claude Code, Codex, Aider, Gemini, Ollama) are configured.

  Restart your terminal once for the env vars to take effect.
  After that, everything is automatic — Squeezr starts silently on every login.

  squeezr status   — check it's running
  squeezr gain     — see token savings
`)
  }
}

function setupUnix() {
  const squeezrBin = process.argv[1]
  const nodeExe = process.execPath
  const platform = process.platform

  console.log(`Setting up Squeezr for ${platform === 'darwin' ? 'macOS' : 'Linux'}...\n`)

  // 1. Set env vars + auto-heal guard in shell profile
  const distIndex = path.join(ROOT, 'dist', 'index.js')
  const port = process.env.SQUEEZR_PORT || 8080
  const mitmPort = getMitmPort(port)
  const bundlePath = path.join(os.homedir(), '.squeezr', 'mitm-ca', 'bundle.crt')
  const shellBlock = [
    `# squeezr env vars`,
    `export ANTHROPIC_BASE_URL=http://localhost:${port}`,
    `export openai_base_url=http://localhost:${port}`,
    `export GEMINI_API_BASE_URL=http://localhost:${port}`,
    `# squeezr MITM proxy for Codex (TLS interception)`,
    `export HTTPS_PROXY=http://localhost:${mitmPort}`,
    `export SSL_CERT_FILE=${bundlePath}`,
    `# squeezr auto-heal: start proxy if not running`,
    `if ! curl -sf http://localhost:${port}/squeezr/health >/dev/null 2>&1; then`,
    `  nohup ${nodeExe} ${distIndex} >> "${os.homedir()}/.squeezr/squeezr.log" 2>&1 &`,
    `  disown`,
    `fi`,
  ].join('\n')
  const marker = '# squeezr env vars'
  const profiles = [
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.bash_profile'),
  ]
  const profile = profiles.find(p => fs.existsSync(p)) ?? profiles[0]
  const existing = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf-8') : ''
  if (!existing.includes(marker)) {
    fs.appendFileSync(profile, `\n${shellBlock}\n`)
    console.log(`  [ok] Env vars + auto-heal added to ${profile}`)
  } else {
    if (!existing.includes('SSL_CERT_FILE') || !existing.includes('squeezr MITM')) {
      // Re-write block to include MITM vars
      const updatedContent = existing.replace(
        /# squeezr env vars[\s\S]*?fi\n/,
        shellBlock + '\n'
      )
      fs.writeFileSync(profile, updatedContent)
      console.log(`  [ok] Shell profile updated with MITM proxy vars`)
    } else {
      console.log(`  [skip] Env vars + auto-heal already in ${profile}`)
    }
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

// ── WSL2 detection ───────────────────────────────────────────────────────────

function isWSL() {
  try {
    const release = fs.readFileSync('/proc/version', 'utf-8')
    return /microsoft|wsl/i.test(release)
  } catch {
    return false
  }
}

// ── squeezr setup — WSL2 ────────────────────────────────────────────────────

function setupWSL() {
  const nodeExe = process.execPath
  const distIndex = path.join(ROOT, 'dist', 'index.js')

  console.log('Setting up Squeezr for WSL2...\n')

  // 1. Set env vars + auto-heal guard in WSL shell profile (.bashrc / .zshrc)
  //    The guard checks if the proxy is alive on terminal open. If not, it starts
  //    it in the background. This is the safety net for WSL2 where systemd and
  //    Task Scheduler may both fail.
  const port = process.env.SQUEEZR_PORT || 8080
  const mitmPort = getMitmPort(port)
  const bundlePath = path.join(os.homedir(), '.squeezr', 'mitm-ca', 'bundle.crt')
  const shellBlock = [
    `# squeezr env vars`,
    `export ANTHROPIC_BASE_URL=http://localhost:${port}`,
    `export openai_base_url=http://localhost:${port}`,
    `export GEMINI_API_BASE_URL=http://localhost:${port}`,
    `export HTTPS_PROXY=http://localhost:${mitmPort}`,
    `export SSL_CERT_FILE=${bundlePath}`,
    `# squeezr auto-heal: start proxy if not running`,
    `if ! curl -sf http://localhost:${port}/squeezr/health >/dev/null 2>&1; then`,
    `  nohup ${nodeExe} ${distIndex} >> "${os.homedir()}/.squeezr/squeezr.log" 2>&1 &`,
    `  disown`,
    `fi`,
  ].join('\n')
  const marker = '# squeezr env vars'
  const profiles = [
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.bash_profile'),
  ]
  const profile = profiles.find(p => fs.existsSync(p)) ?? profiles[1]
  const existing = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf-8') : ''
  if (!existing.includes(marker)) {
    fs.appendFileSync(profile, `\n${shellBlock}\n`)
    console.log(`  [ok] Env vars + auto-heal added to ${profile}`)
  } else {
    // Update existing block if missing MITM proxy vars
    if (!existing.includes('SSL_CERT_FILE') || !existing.includes('HTTPS_PROXY')) {
      const updatedContent = existing.replace(
        /# squeezr env vars[\s\S]*?fi\n/,
        shellBlock + '\n'
      )
      fs.writeFileSync(profile, updatedContent)
      console.log(`  [ok] Shell profile updated with MITM proxy vars`)
    } else {
      console.log(`  [skip] Env vars already in ${profile}`)
    }
  }

  // 2. Set Windows env vars via setx.exe (so Windows-launched CLIs see them)
  const setxExe = '/mnt/c/Windows/System32/setx.exe'
  const winVars = {
    ANTHROPIC_BASE_URL: 'http://localhost:8080',
    openai_base_url: 'http://localhost:8080',
    GEMINI_API_BASE_URL: 'http://localhost:8080',
  }
  if (fs.existsSync(setxExe)) {
    for (const [key, value] of Object.entries(winVars)) {
      try {
        execSync(`"${setxExe}" ${key} "${value}"`, { stdio: 'pipe' })
        console.log(`  [ok] Windows env: ${key}=${value}`)
      } catch {
        console.log(`  [skip] Windows env: ${key} could not be set`)
      }
    }
  } else {
    console.log('  [skip] setx.exe not found — Windows env vars not set')
  }

  // 3. Auto-start: try systemd first (WSL2 with systemd enabled), fallback to
  //    Windows Task Scheduler, then plain background process
  let autoStartDone = false

  // 3a. Try systemd (works on newer WSL2 with [boot] systemd=true in wsl.conf)
  try {
    const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user')
    fs.mkdirSync(serviceDir, { recursive: true })
    const servicePath = path.join(serviceDir, 'squeezr.service')
    fs.writeFileSync(servicePath, `[Unit]
Description=Squeezr AI proxy
After=network.target

[Service]
ExecStart=${nodeExe} ${distIndex}
Restart=always
RestartSec=5
WorkingDirectory=${ROOT}

[Install]
WantedBy=default.target
`)
    execSync('systemctl --user daemon-reload && systemctl --user enable --now squeezr', { stdio: 'pipe' })
    console.log('  [ok] Auto-start registered via systemd')
    autoStartDone = true
  } catch {
    // systemd not available — try Windows Task Scheduler
  }

  // 3b. Fallback: Windows Task Scheduler via powershell.exe
  if (!autoStartDone) {
    const winNodeExe = execSync('wslpath -w "$(which node)"', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    const winDistIndex = execSync(`wslpath -w "${distIndex}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    const winRoot = execSync(`wslpath -w "${ROOT}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    const taskName = 'Squeezr'
    const ps = [
      `$e = Get-ScheduledTask -TaskName '${taskName}' -ErrorAction SilentlyContinue`,
      `if ($e) { Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false }`,
      `$a = New-ScheduledTaskAction -Execute 'wsl.exe' -Argument '-d ${os.hostname()} -- ${nodeExe} ${distIndex}' -WorkingDirectory '${winRoot}'`,
      `$t = New-ScheduledTaskTrigger -AtLogon`,
      `$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)`,
      `Register-ScheduledTask -TaskName '${taskName}' -Action $a -Trigger $t -Settings $s -Force | Out-Null`,
    ].join('; ')

    try {
      execSync(`powershell.exe -NoProfile -Command "${ps}"`, { stdio: 'pipe' })
      console.log('  [ok] Auto-start registered via Windows Task Scheduler')
      autoStartDone = true
    } catch {
      console.log('  [warn] Task Scheduler failed — run PowerShell as admin for auto-start')
    }
  }

  // 4. Start proxy now as a detached background process
  const logDir = path.join(os.homedir(), '.squeezr')
  const logFile = path.join(logDir, 'squeezr.log')
  fs.mkdirSync(logDir, { recursive: true })
  const logFd = fs.openSync(logFile, 'a')
  const child = spawn(nodeExe, [distIndex], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: ROOT,
  })
  child.unref()
  fs.closeSync(logFd)
  console.log(`  [ok] Squeezr started in background (pid ${child.pid})`)
  console.log(`  [ok] Logs → ${logFile}`)

  // 5. Apply env vars to current process so calling `source` is not needed
  //    This won't affect the parent shell, but at least prints guidance.
  console.log(`
Done!

  Squeezr is running on http://localhost:8080
  All CLIs (Claude Code, Codex, Aider, Gemini, Ollama) are configured.

  Windows env vars are set (effective in new terminals immediately).
  WSL env vars added to ${profile}.

  To activate in THIS terminal: source ${profile}
  New terminals will have everything configured automatically.

  squeezr status   — check it's running
  squeezr gain     — see token savings
`)
}

// ── CLI router ────────────────────────────────────────────────────────────────

switch (command) {
  case undefined:
  case 'start':
    startDaemon()
    break

  case 'setup':
    if (process.platform === 'win32') setupWindows()
    else if (isWSL()) setupWSL()
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

  case 'ports':
    await configurePorts()
    break
  case 'uninstall':
    await uninstall()
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
