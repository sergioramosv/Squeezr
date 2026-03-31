#!/usr/bin/env node
'use strict'

const { spawn, execSync } = require('child_process')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const args = process.argv.slice(2)
const command = args[0]

const HELP = `
Squeezr — AI context compressor for Claude Code, Codex, Aider, Gemini CLI and Ollama

Usage:
  squeezr                  Start the proxy (default)
  squeezr start            Start the proxy
  squeezr gain             Show token savings stats
  squeezr gain --reset     Reset saved stats
  squeezr status           Check if proxy is running
  squeezr config           Print config file path

Set your CLI to use Squeezr:
  Claude Code:   ANTHROPIC_BASE_URL=http://localhost:8080
  Codex / Aider: OPENAI_BASE_URL=http://localhost:8080
  Gemini CLI:    GEMINI_API_BASE_URL=http://localhost:8080
  Ollama:        OPENAI_BASE_URL=http://localhost:8080
`

function findPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const out = execSync(`${cmd} --version`, { stdio: 'pipe' }).toString()
      const match = out.match(/(\d+)\.(\d+)/)
      if (match && parseInt(match[1]) >= 3 && parseInt(match[2]) >= 9) {
        return cmd
      }
    } catch {}
  }
  return null
}

function run(script, extraArgs = []) {
  const python = findPython()
  if (!python) {
    console.error('Error: Python 3.9+ is required. Install it from https://python.org')
    process.exit(1)
  }
  const child = spawn(python, [path.join(ROOT, script), ...extraArgs], {
    stdio: 'inherit',
    cwd: ROOT,
  })
  child.on('exit', code => process.exit(code ?? 0))
}

async function checkStatus() {
  const http = require('http')
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

switch (command) {
  case undefined:
  case 'start':
    run('main.py')
    break

  case 'gain':
    run('gain.py', args.slice(1))
    break

  case 'status':
    checkStatus()
    break

  case 'config':
    console.log(path.join(ROOT, 'squeezr.toml'))
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
