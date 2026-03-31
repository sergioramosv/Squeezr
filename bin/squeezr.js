#!/usr/bin/env node
'use strict'

const { spawn } = require('child_process')
const http = require('http')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const args = process.argv.slice(2)
const command = args[0]

const HELP = `
Squeezr v1.8.0 — AI context compressor for Claude Code, Codex, Aider, Gemini CLI and Ollama

Usage:
  squeezr                  Start the proxy (default)
  squeezr start            Start the proxy
  squeezr gain             Show token savings stats
  squeezr gain --reset     Reset saved stats
  squeezr discover         Show pattern coverage report (proxy must be running)
  squeezr status           Check if proxy is running
  squeezr config           Print config file path and current settings
  squeezr help             Show this help

Set your CLI to use Squeezr:
  Claude Code:   ANTHROPIC_BASE_URL=http://localhost:8080
  Codex / Aider: OPENAI_BASE_URL=http://localhost:8080
  Gemini CLI:    GEMINI_API_BASE_URL=http://localhost:8080
  Ollama:        OPENAI_BASE_URL=http://localhost:8080
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

switch (command) {
  case undefined:
  case 'start':
    runNode('index.js')
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
