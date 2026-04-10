import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { config } from './config.js'

// ── CA / cert paths ───────────────────────────────────────────────────────────

const CA_DIR       = join(homedir(), '.squeezr', 'mitm-ca')
const CA_KEY_PATH  = join(CA_DIR, 'ca.key')
const CA_CERT_PATH = join(CA_DIR, 'ca.crt')
export const BUNDLE_PATH = join(CA_DIR, 'bundle.crt')
export const MITM_PORT   = config.mitmPort

// ── CA generation ─────────────────────────────────────────────────────────────

function ensureCA() {
  const certsExist = fs.existsSync(CA_KEY_PATH) && fs.existsSync(CA_CERT_PATH)

  if (!certsExist) {
    fs.mkdirSync(CA_DIR, { recursive: true, mode: 0o700 })
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter  = new Date()
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10)
    const attrs = [{ name: 'commonName', value: 'Squeezr-MITM-CA' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true },
    ])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    fs.writeFileSync(CA_KEY_PATH, forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 })
    fs.writeFileSync(CA_CERT_PATH, forge.pki.certificateToPem(cert), { mode: 0o644 })
    console.log(`[squeezr/mitm] CA generated → ${CA_CERT_PATH}`)
  }

  // Always regenerate bundle.crt from the CA cert only.
  // Avoid concatenating system CA bundles — they can contain certs that
  // BoringSSL/Node.js rejects (e.g. on WSL), causing NODE_EXTRA_CA_CERTS to fail.
  // Node.js already trusts its own built-in root CAs, so only the squeezr CA
  // cert is needed here.
  const caCertPem = fs.readFileSync(CA_CERT_PATH, 'utf-8')
  fs.writeFileSync(BUNDLE_PATH, caCertPem, { mode: 0o644 })
}

// ── Per-host cert (cached) ────────────────────────────────────────────────────

const certCache = new Map<string, { key: string; cert: string }>()

function getCert(hostname: string) {
  if (certCache.has(hostname)) return certCache.get(hostname)!
  const caKey  = forge.pki.privateKeyFromPem(fs.readFileSync(CA_KEY_PATH, 'utf-8'))
  const caCert = forge.pki.certificateFromPem(fs.readFileSync(CA_CERT_PATH, 'utf-8'))
  const keys   = forge.pki.rsa.generateKeyPair(2048)
  const cert   = forge.pki.createCertificate()
  cert.publicKey   = keys.publicKey
  cert.serialNumber = crypto.randomBytes(8).toString('hex')
  cert.validity.notBefore = new Date()
  cert.validity.notAfter  = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)
  cert.setSubject([{ name: 'commonName', value: hostname }])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] }])
  cert.sign(caKey, forge.md.sha256.create())
  const result = {
    key:  forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  }
  certCache.set(hostname, result)
  return result
}

// ── WebSocket frame helpers ───────────────────────────────────────────────────

function xorMask(data: Buffer, key: Buffer): Buffer {
  const out = Buffer.from(data)
  for (let i = 0; i < out.length; i++) out[i] ^= key[i % 4]
  return out
}

function parseWsFrame(buf: Buffer): { opcode: number; masked: boolean; mask: Buffer; payload: Buffer; total: number } | null {
  if (buf.length < 2) return null
  const opcode = buf[0] & 0x0F
  const masked = !!(buf[1] & 0x80)
  let plen = buf[1] & 0x7F
  let hlen = 2

  if (plen === 126) {
    if (buf.length < 4) return null
    plen = buf.readUInt16BE(2); hlen = 4
  } else if (plen === 127) {
    if (buf.length < 10) return null
    plen = Number(buf.readBigUInt64BE(2)); hlen = 10
  }

  const mask = Buffer.alloc(4)
  if (masked) {
    if (buf.length < hlen + 4) return null
    buf.copy(mask, 0, hlen, hlen + 4); hlen += 4
  }

  if (buf.length < hlen + plen) return null
  return { opcode, masked, mask, payload: buf.slice(hlen, hlen + plen), total: hlen + plen }
}

function buildWsFrame(opcode: number, payload: Buffer, masked: boolean): Buffer {
  const key = masked ? crypto.randomBytes(4) : Buffer.alloc(0)
  const plen = payload.length
  let hlen = 2 + (masked ? 4 : 0)
  if (plen >= 65536) hlen += 8
  else if (plen >= 126) hlen += 2

  const frame = Buffer.alloc(hlen + plen)
  frame[0] = 0x80 | opcode

  if (plen >= 65536) {
    frame[1] = (masked ? 0x80 : 0) | 127
    frame.writeBigUInt64BE(BigInt(plen), 2)
    if (masked) key.copy(frame, 10)
  } else if (plen >= 126) {
    frame[1] = (masked ? 0x80 : 0) | 126
    frame.writeUInt16BE(plen, 2)
    if (masked) key.copy(frame, 4)
  } else {
    frame[1] = (masked ? 0x80 : 0) | plen
    if (masked) key.copy(frame, 2)
  }

  const body = masked ? xorMask(payload, key) : payload
  body.copy(frame, hlen)
  return frame
}

// ── Compress via separate WS to chatgpt.com ──────────────────────────────────

const COMPRESS_THRESHOLD = config.threshold ?? 800
const COMPRESS_MODEL = 'gpt-5.4-mini'
const COMPRESS_PROMPT = 'Extract ONLY essential info: errors, file paths, function names, test failures, key values, warnings. Very concise, under 150 tokens. No preamble.'

function compressViaWs(text: string, authToken: string, accountId: string): Promise<string> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { resolve(text); socket.destroy() }, 15_000)

    const wsKey = crypto.randomBytes(16).toString('base64')
    const upgradeReq = [
      'GET /backend-api/codex/responses HTTP/1.1',
      'Host: chatgpt.com',
      `Authorization: ${authToken}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${wsKey}`,
      'Sec-WebSocket-Version: 13',
      'Originator: codex_exec',
      ...(accountId ? [`chatgpt-account-id: ${accountId}`] : []),
      '', '',
    ].join('\r\n')

    const socket = tls.connect(443, 'chatgpt.com', { servername: 'chatgpt.com' }, () => {
      socket.write(upgradeReq)
    })

    socket.on('error', () => { clearTimeout(timeout); resolve(text) })

    let gotUpgrade = false
    let buf = Buffer.alloc(0)

    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])

      if (!gotUpgrade) {
        const str = buf.toString('latin1')
        if (!str.includes('\r\n\r\n')) return
        const headerEnd = str.indexOf('\r\n\r\n')
        const headers = str.slice(0, headerEnd)

        if (!headers.startsWith('HTTP/1.1 101')) {
          clearTimeout(timeout); resolve(text); socket.destroy(); return
        }

        gotUpgrade = true
        buf = buf.slice(headerEnd + 4)

        // Send compression request
        const msg = JSON.stringify({
          type: 'response.create',
          model: COMPRESS_MODEL,
          instructions: COMPRESS_PROMPT,
          input: [{ role: 'user', content: text.slice(0, 4000) }],
        })
        socket.write(buildWsFrame(1, Buffer.from(msg), true))
      }

      // Parse response frames
      while (buf.length >= 2) {
        const f = parseWsFrame(buf)
        if (!f) break
        buf = buf.slice(f.total)

        if (f.opcode === 1) {
          const payload = f.masked ? xorMask(f.payload, f.mask) : f.payload
          try {
            const evt = JSON.parse(payload.toString('utf-8'))
            if (evt.type === 'response.output_text.done') {
              clearTimeout(timeout)
              resolve(evt.text || text)
              socket.destroy()
              return
            }
            if (evt.type === 'response.completed' || evt.type === 'response.done') {
              const output = evt.response?.output?.[0]?.content?.[0]?.text ?? ''
              clearTimeout(timeout)
              resolve(output || text)
              socket.destroy()
              return
            }
          } catch {}
        } else if (f.opcode === 8) {
          clearTimeout(timeout); resolve(text); socket.destroy(); return
        }
      }
    })
  })
}

// ── Process Codex request: find tool outputs and compress ─────────────────────

async function processCodexRequest(json: any, authToken: string, accountId: string): Promise<number> {
  const messages: any[] = json.input ?? json.messages ?? []
  let saved = 0

  for (const msg of messages) {
    // Responses API: type=function_call_output, output field
    // Chat Completions API: role=tool/function, content field
    const isToolMsg = msg.type === 'function_call_output' || msg.role === 'tool' || msg.role === 'function'
    if (!isToolMsg) continue

    const text = msg.output ?? (typeof msg.content === 'string' ? msg.content : null)
    if (!text || text.length < COMPRESS_THRESHOLD) continue

    const compressed = await compressViaWs(text, authToken, accountId)
    if (compressed.length < text.length) {
      if (msg.output !== undefined) msg.output = compressed
      else msg.content = compressed
      saved += text.length - compressed.length
    }
  }
  return saved
}

// ── CONNECT handler (HTTPS MITM) ─────────────────────────────────────────────

function handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, _head: Buffer) {
  const [hostname, portStr] = (req.url ?? '').split(':')
  const port = parseInt(portStr) || 443

  // Only MITM chatgpt.com — everything else gets a transparent TCP tunnel
  if (hostname !== 'chatgpt.com') {
    const upstream = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on('error', () => { try { clientSocket.destroy() } catch {} })
    clientSocket.on('error', () => { try { upstream.destroy() } catch {} })
    return
  }

  clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')

  const { key, cert } = getCert(hostname)
  const clientTls = new tls.TLSSocket(clientSocket, { isServer: true, key, cert })
  clientTls.on('error', () => {})

  // Capture chatgpt-account-id from any HTTP request to chatgpt.com
  let accountId = ''

  clientTls.once('data', (firstChunk: Buffer) => {
    const raw = firstChunk.toString('latin1')
    const peek = raw.toLowerCase()

    // Capture account-id header
    const acctMatch = raw.match(/chatgpt-account-id:\s*([^\r\n]+)/i)
    if (acctMatch) accountId = acctMatch[1].trim()

    // ── WebSocket upgrade ─────────────────────────────────────────────────────
    if (peek.includes('upgrade: websocket')) {
      const isCodexWs = peek.includes('/backend-api/codex/responses')

      // Extract auth token
      const authMatch = raw.match(/[Aa]uthorization:\s*(Bearer [^\r\n]+)/)
      const authToken = authMatch ? authMatch[1].trim() : ''

      // Strip permessage-deflate so frames are plain text (avoids context desync)
      const modified = raw.replace(/Sec-WebSocket-Extensions:[^\r\n]*\r\n/gi, '')
      const upChunk = Buffer.from(modified, 'latin1')

      const upSocket = tls.connect(port, hostname, { servername: hostname }, () => {
        upSocket.write(upChunk)
      })
      upSocket.on('error', () => { try { clientTls.destroy() } catch {} })

      upSocket.once('data', (upgradeResp: Buffer) => {
        clientTls.write(upgradeResp)

        if (!isCodexWs) {
          // Non-Codex WS: bidirectional passthrough
          upSocket.on('data', (c: Buffer) => { try { clientTls.write(c) } catch {} })
          clientTls.on('data', (c: Buffer) => { try { upSocket.write(c) } catch {} })
          return
        }

        // ── Codex WS: intercept client→server, compress tool results ──────────
        let clientBuf = Buffer.alloc(0)

        clientTls.on('data', (chunk: Buffer) => {
          clientBuf = Buffer.concat([clientBuf, chunk])

          const processNext = async () => {
            while (clientBuf.length >= 2) {
              const frame = parseWsFrame(clientBuf)
              if (!frame) break

              const originalFrame = clientBuf.slice(0, frame.total)
              clientBuf = clientBuf.slice(frame.total)

              if (frame.opcode === 1) {
                const plain = frame.masked ? xorMask(frame.payload, frame.mask) : frame.payload

                try {
                  const json = JSON.parse(plain.toString('utf-8'))
                  const saved = await processCodexRequest(json, authToken, accountId)
                  if (saved > 0) {
                    console.log(`[squeezr/mitm] Codex compressed: -${saved} chars via ${COMPRESS_MODEL}`)
                    const newFrame = buildWsFrame(frame.opcode, Buffer.from(JSON.stringify(json)), frame.masked)
                    try { upSocket.write(newFrame) } catch {}
                    continue
                  }
                } catch {}
              }

              try { upSocket.write(originalFrame) } catch {}
            }
          }

          processNext().catch(() => {})
        })

        // Server→client: pass through unmodified
        upSocket.on('data', (c: Buffer) => { try { clientTls.write(c) } catch {} })
      })

      clientTls.on('error', () => { try { upSocket.destroy() } catch {} })
      clientTls.on('close', () => { try { upSocket.destroy() } catch {} })
      upSocket.on('close', () => { try { clientTls.destroy() } catch {} })
      return
    }

    // ── Regular HTTP/1.1 (non-WebSocket) ─────────────────────────────────────
    const fakeServer = new http.Server()
    fakeServer.emit('connection', clientTls)
    setImmediate(() => { if (!clientTls.destroyed) clientTls.emit('data', firstChunk) })

    fakeServer.on('request', (clientReq: http.IncomingMessage, clientRes: http.ServerResponse) => {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(clientReq.headers)) {
        if (/^[\w\-]+$/.test(k)) headers[k] = Array.isArray(v) ? v.join(', ') : (v ?? '')
      }
      headers['host'] = hostname

      // Capture account-id from HTTP requests too
      if (clientReq.headers['chatgpt-account-id'] && !accountId) {
        accountId = String(clientReq.headers['chatgpt-account-id'])
      }

      const upReq = https.request({
        hostname, port,
        path: clientReq.url ?? '/',
        method: clientReq.method ?? 'GET',
        headers,
      }, (upRes) => {
        clientRes.writeHead(upRes.statusCode ?? 200, upRes.headers)
        upRes.pipe(clientRes)
      })
      upReq.on('error', () => { try { clientRes.destroy() } catch {} })
      clientReq.pipe(upReq)
    })

    fakeServer.on('error', () => { try { clientTls.destroy() } catch {} })
  })
}

// ── Plain HTTP handler ────────────────────────────────────────────────────────

function handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
  const upReq = http.request({
    hostname: req.headers.host?.split(':')[0] ?? 'localhost',
    port: 80,
    path: req.url,
    method: req.method,
    headers: req.headers,
  }, (upRes) => {
    res.writeHead(upRes.statusCode ?? 200, upRes.headers)
    upRes.pipe(res)
  })
  upReq.on('error', () => res.writeHead(502).end())
  req.pipe(upReq)
}

// ── Server lifecycle ──────────────────────────────────────────────────────────

let mitmServer: http.Server | null = null

export function startMitmProxy() {
  try {
    ensureCA()
  } catch (err) {
    console.error('[squeezr/mitm] CA generation failed:', err)
    return
  }

  mitmServer = http.createServer(handleHttp)
  mitmServer.on('connect', handleConnect)
  mitmServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code !== 'EADDRINUSE') console.error('[squeezr/mitm] error:', err.message)
  })
  mitmServer.listen(MITM_PORT, () => {
    console.log(`[squeezr/mitm] HTTPS proxy on http://localhost:${MITM_PORT}`)
  })
}

export function stopMitmProxy() {
  mitmServer?.close()
  mitmServer = null
}
