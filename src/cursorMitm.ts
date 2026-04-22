/**
 * Cursor Subscription MITM Proxy
 *
 * Intercepts Cursor IDE (Electron/Chromium) traffic to api2.cursor.sh,
 * compresses the conversation context using Cursor's own models (cursor-small),
 * and forwards the compressed request transparently.
 *
 * Protocol: ConnectRPC over HTTP/2 with binary Protobuf
 * Target:   api2.cursor.sh/aiserver.v1.ChatService/StreamUnifiedChatWithTools
 */

import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import http2 from 'node:http2'
import fs from 'node:fs'
import zlib from 'node:zlib'
import dns from 'node:dns/promises'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { config } from './config.js'

// ── Constants ────────────────────────────────────────────────────────────────

const CURSOR_API_HOST = 'api2.cursor.sh'

// api5 hosts: used for chat/agent in Cursor >= 3.x
const CURSOR_AGENT_HOSTS = new Set([
  'agent.api5.cursor.sh',
  'agentn.api5.cursor.sh',
  'agent-gcpp-uswest.api5.cursor.sh',
  'agentn-gcpp-uswest.api5.cursor.sh',
  'agentn-gcpp-eucentral.api5.cursor.sh',
  'agentn-gcpp-apsoutheast.api5.cursor.sh',
])

// All intercepted hosts
const ALL_CURSOR_HOSTS = new Set([CURSOR_API_HOST, ...CURSOR_AGENT_HOSTS])

// api2 paths (ConnectRPC/protobuf)
const CURSOR_CHAT_PATH = '/aiserver.v1.ChatService/StreamUnifiedChatWithTools'
const CURSOR_COMPOSER_PATH = '/aiserver.v1.AiService/StreamComposer'
const CURSOR_CHAT_HARD_PATH = '/aiserver.v1.AiService/StreamChatTryReallyHard'

// api5 paths (Agent service — Cursor >= 3.x)
// NOTE: AgentService/Run intentionally NOT in INTERCEPTED_PATHS yet —
// pass-through until we understand the full streaming protocol.
const CURSOR_AGENT_RUN_PATH = '/agent.v1.AgentService/Run'

const INTERCEPTED_PATHS = new Set([
  CURSOR_CHAT_PATH, CURSOR_COMPOSER_PATH, CURSOR_CHAT_HARD_PATH,
])

// Minimal Protobuf field numbers for GetChatRequest (from cursor-rpc protos)
// We decode only the fields we need to compress, pass-through everything else at binary level
const PROTO_FIELD_CONVERSATION = 2  // repeated ConversationMessage
const PROTO_FIELD_ROLE = 1          // MessageType enum in ConversationMessage
const PROTO_FIELD_TEXT = 2          // string text in ConversationMessage

// Protobuf wire types
const WIRE_VARINT = 0
const WIRE_LENGTH_DELIMITED = 2

const COMPRESS_THRESHOLD = config.threshold ?? 800
const KEEP_RECENT = config.keepRecent ?? 3

// ── CA paths (shared with codexMitm) ─────────────────────────────────────────

const CA_DIR = join(homedir(), '.squeezr', 'mitm-ca')
const CA_KEY_PATH = join(CA_DIR, 'ca.key')
const CA_CERT_PATH = join(CA_DIR, 'ca.crt')

// ── Per-host cert (cached) ───────────────────────────────────────────────────

const certCache = new Map<string, { key: string; cert: string }>()

function getCert(hostname: string) {
  if (certCache.has(hostname)) return certCache.get(hostname)!
  const caKey = forge.pki.privateKeyFromPem(fs.readFileSync(CA_KEY_PATH, 'utf-8'))
  const caCert = forge.pki.certificateFromPem(fs.readFileSync(CA_CERT_PATH, 'utf-8'))
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = crypto.randomBytes(8).toString('hex')
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)
  cert.setSubject([{ name: 'commonName', value: hostname }])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] }])
  cert.sign(caKey, forge.md.sha256.create())
  const result = {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  }
  certCache.set(hostname, result)
  return result
}

// ── ConnectRPC envelope framing ──────────────────────────────────────────────
// Wire format: [flag: 1 byte][length: 4 bytes big-endian][payload: N bytes]
// flag 0x00 = uncompressed, 0x01 = gzip (we only handle uncompressed)

function parseConnectFrame(buf: Buffer): { flag: number; payload: Buffer; total: number } | null {
  if (buf.length < 5) return null
  const flag = buf[0]
  const length = buf.readUInt32BE(1)
  if (buf.length < 5 + length) return null
  return { flag, payload: buf.subarray(5, 5 + length), total: 5 + length }
}

function buildConnectFrame(payload: Buffer, flag = 0): Buffer {
  const header = Buffer.alloc(5)
  header[0] = flag
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

// ── Minimal Protobuf decoder/encoder ─────────────────────────────────────────
// We implement just enough proto handling to read/write the conversation field.
// This avoids needing generated code or the full @bufbuild/protobuf runtime.

interface ProtoField {
  fieldNumber: number
  wireType: number
  data: Buffer  // raw bytes for this field (includes tag for re-serialization)
}

function decodeVarint(buf: Buffer, offset: number): { value: number; bytesRead: number } {
  let value = 0
  let shift = 0
  let bytesRead = 0
  while (offset + bytesRead < buf.length) {
    const byte = buf[offset + bytesRead]
    value |= (byte & 0x7F) << shift
    bytesRead++
    if ((byte & 0x80) === 0) break
    shift += 7
  }
  return { value, bytesRead }
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = []
  while (value > 0x7F) {
    bytes.push((value & 0x7F) | 0x80)
    value >>>= 7
  }
  bytes.push(value & 0x7F)
  return Buffer.from(bytes)
}

function encodeTag(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType)
}

function encodeLengthDelimited(fieldNumber: number, data: Buffer): Buffer {
  const tag = encodeTag(fieldNumber, WIRE_LENGTH_DELIMITED)
  const len = encodeVarint(data.length)
  return Buffer.concat([tag, len, data])
}

function encodeString(fieldNumber: number, str: string): Buffer {
  const data = Buffer.from(str, 'utf-8')
  return encodeLengthDelimited(fieldNumber, data)
}

function encodeVarintField(fieldNumber: number, value: number): Buffer {
  const tag = encodeTag(fieldNumber, WIRE_VARINT)
  const val = encodeVarint(value)
  return Buffer.concat([tag, val])
}

/** Parse a protobuf message into raw fields, preserving byte-level data for round-trip */
function parseProtoFields(buf: Buffer): ProtoField[] {
  const fields: ProtoField[] = []
  let offset = 0
  while (offset < buf.length) {
    const tagStart = offset
    const { value: tag, bytesRead: tagBytes } = decodeVarint(buf, offset)
    offset += tagBytes
    const fieldNumber = tag >>> 3
    const wireType = tag & 0x07

    let fieldEnd = offset
    switch (wireType) {
      case 0: { // varint
        while (fieldEnd < buf.length && (buf[fieldEnd] & 0x80) !== 0) fieldEnd++
        fieldEnd++ // last byte
        break
      }
      case 1: { // 64-bit
        fieldEnd += 8
        break
      }
      case 2: { // length-delimited
        const { value: len, bytesRead: lenBytes } = decodeVarint(buf, offset)
        fieldEnd = offset + lenBytes + len
        break
      }
      case 5: { // 32-bit
        fieldEnd += 4
        break
      }
      default:
        // Unknown wire type — skip to end to avoid infinite loop
        fieldEnd = buf.length
    }

    fields.push({
      fieldNumber,
      wireType,
      data: buf.subarray(tagStart, fieldEnd),
    })
    offset = fieldEnd
  }
  return fields
}

/** Extract the payload of a length-delimited field (skipping tag + length prefix) */
function extractLengthDelimitedPayload(rawField: Buffer): Buffer {
  let offset = 0
  // skip tag varint
  while (offset < rawField.length && (rawField[offset] & 0x80) !== 0) offset++
  offset++ // last tag byte
  // read length varint
  const { value: len, bytesRead } = decodeVarint(rawField, offset)
  offset += bytesRead
  return rawField.subarray(offset, offset + len)
}

/** Read a varint field value */
function readVarintValue(rawField: Buffer): number {
  let offset = 0
  while (offset < rawField.length && (rawField[offset] & 0x80) !== 0) offset++
  offset++
  return decodeVarint(rawField, offset).value
}

// ── Conversation extraction and compression ──────────────────────────────────

interface ConversationMessage {
  role: number  // 0=unspecified, 1=human, 2=ai
  text: string
  originalBytes: Buffer  // for pass-through if not compressed
}

function extractConversation(requestPayload: Buffer): { messages: ConversationMessage[]; otherFields: Buffer[] } {
  const fields = parseProtoFields(requestPayload)
  const messages: ConversationMessage[] = []
  const otherFields: Buffer[] = []

  for (const field of fields) {
    if (field.fieldNumber === PROTO_FIELD_CONVERSATION && field.wireType === WIRE_LENGTH_DELIMITED) {
      const msgPayload = extractLengthDelimitedPayload(field.data)
      const msgFields = parseProtoFields(msgPayload)
      let role = 0
      let text = ''
      for (const mf of msgFields) {
        if (mf.fieldNumber === PROTO_FIELD_ROLE && mf.wireType === WIRE_VARINT) {
          role = readVarintValue(mf.data)
        } else if (mf.fieldNumber === PROTO_FIELD_TEXT && mf.wireType === WIRE_LENGTH_DELIMITED) {
          text = extractLengthDelimitedPayload(mf.data).toString('utf-8')
        }
      }
      messages.push({ role, text, originalBytes: field.data })
    } else {
      otherFields.push(field.data)
    }
  }

  return { messages, otherFields }
}

function rebuildRequest(messages: ConversationMessage[], otherFields: Buffer[], compressed: Map<number, string>): Buffer {
  const parts: Buffer[] = []

  // Re-add non-conversation fields in original order
  // We need to interleave them, but proto doesn't care about field order
  for (const raw of otherFields) {
    parts.push(raw)
  }

  // Re-add conversation messages
  for (let i = 0; i < messages.length; i++) {
    if (compressed.has(i)) {
      // Build new ConversationMessage proto
      const msgPayload = Buffer.concat([
        encodeVarintField(PROTO_FIELD_ROLE, messages[i].role),
        encodeString(PROTO_FIELD_TEXT, compressed.get(i)!),
      ])
      parts.push(encodeLengthDelimited(PROTO_FIELD_CONVERSATION, msgPayload))
    } else {
      // Keep original bytes
      parts.push(messages[i].originalBytes)
    }
  }

  return Buffer.concat(parts)
}

function isGzip(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

// ── Compression via Cursor's own API ─────────────────────────────────────────

let cursorStats = { requests: 0, compressed: 0, charsSaved: 0 }

export function getCursorStats() {
  return { ...cursorStats }
}

async function compressViaCursor(
  texts: string[],
  bearerToken: string,
  headers: Record<string, string>,
): Promise<string[]> {
  // Build a compression request using the same Cursor API
  // We ask cursor-small to summarize multiple conversation turns
  const combinedText = texts.map((t, i) => `[Turn ${i + 1}]:\n${t}`).join('\n\n')
  const prompt = `Compress this conversation history into a concise summary preserving: file paths, function names, error messages, decisions made, and key technical context. Be very concise, under ${Math.max(150, Math.floor(combinedText.length / 6))} chars.\n\n${combinedText}`

  try {
    // Build a minimal GetChatRequest protobuf
    const conversationMsg = Buffer.concat([
      encodeVarintField(PROTO_FIELD_ROLE, 1), // HUMAN
      encodeString(PROTO_FIELD_TEXT, prompt),
    ])

    const requestPayload = encodeLengthDelimited(PROTO_FIELD_CONVERSATION, conversationMsg)
    const frame = buildConnectFrame(requestPayload)

    // Make HTTP/2 request to api2.cursor.sh
    return await new Promise<string[]>((resolve) => {
      const timeout = setTimeout(() => resolve(texts), 15_000)

      const session = http2.connect(`https://${CURSOR_API_HOST}`, {
        // Trust system CAs + our MITM CA
        rejectUnauthorized: true,
      })

      session.on('error', () => {
        clearTimeout(timeout)
        resolve(texts)
      })

      const reqHeaders: Record<string, string> = {
        ':method': 'POST',
        ':path': CURSOR_CHAT_PATH,
        ':authority': CURSOR_API_HOST,
        'content-type': 'application/connect+proto',
        'connect-protocol-version': '1',
        'authorization': bearerToken,
      }

      // Forward Cursor-specific headers
      for (const [k, v] of Object.entries(headers)) {
        const lk = k.toLowerCase()
        if (lk.startsWith('x-cursor-') || lk === 'x-ghost-mode' || lk === 'x-session-id' || lk === 'x-client-key') {
          reqHeaders[lk] = v
        }
      }

      const req = session.request(reqHeaders)
      req.write(frame)
      req.end()

      let responseBuf = Buffer.alloc(0)

      req.on('data', (chunk: Buffer) => {
        responseBuf = Buffer.concat([responseBuf, chunk])
      })

      req.on('end', () => {
        clearTimeout(timeout)
        try {
          // Parse response ConnectRPC frame(s)
          const responseFrame = parseConnectFrame(responseBuf)
          if (responseFrame && responseFrame.flag === 0) {
            // Parse the response protobuf — look for text field
            const respFields = parseProtoFields(responseFrame.payload)
            for (const f of respFields) {
              if (f.wireType === WIRE_LENGTH_DELIMITED) {
                const inner = extractLengthDelimitedPayload(f.data)
                const innerFields = parseProtoFields(inner)
                for (const inf of innerFields) {
                  if (inf.wireType === WIRE_LENGTH_DELIMITED) {
                    const text = extractLengthDelimitedPayload(inf.data).toString('utf-8')
                    if (text.length > 20 && text.length < combinedText.length) {
                      session.close()
                      resolve([text])
                      return
                    }
                  }
                }
              }
            }
          }
          session.close()
          resolve(texts) // fallback: return originals
        } catch {
          session.close()
          resolve(texts)
        }
      })

      req.on('error', () => {
        clearTimeout(timeout)
        session.close()
        resolve(texts)
      })
    })
  } catch {
    return texts
  }
}

// ── Deterministic compression (no LLM, pattern-based) ────────────────────────

function deterministicCompress(text: string): string {
  let out = text
  // Remove duplicate blank lines
  out = out.replace(/\n{3,}/g, '\n\n')
  // Remove trailing whitespace per line
  out = out.replace(/[ \t]+$/gm, '')
  // Collapse repeated log-like lines (keep first + count)
  const lines = out.split('\n')
  const result: string[] = []
  let lastLine = ''
  let repeatCount = 0
  for (const line of lines) {
    if (line === lastLine && line.trim().length > 0) {
      repeatCount++
    } else {
      if (repeatCount > 0) {
        result.push(`  ... (repeated ${repeatCount}x)`)
        repeatCount = 0
      }
      result.push(line)
      lastLine = line
    }
  }
  if (repeatCount > 0) result.push(`  ... (repeated ${repeatCount}x)`)
  return result.join('\n')
}

// ── HTTP/1.1 → HTTP/2 bridge for api2.cursor.sh ─────────────────────────────
// When Cursor runs with --disable-http2, it sends HTTP/1.1 but api2.cursor.sh
// requires HTTP/2. We accept HTTP/1.1, parse the request, optionally compress,
// and forward it over HTTP/2.

function handleCursorH1Bridge(clientSocket: tls.TLSSocket, hostname: string) {
  // Persistent H2 session to upstream — reused across keep-alive requests
  let upstreamH2: http2.ClientHttp2Session | null = null

  function getUpstream(): http2.ClientHttp2Session {
    if (upstreamH2 && !upstreamH2.closed && !upstreamH2.destroyed) return upstreamH2
    upstreamH2 = http2.connect(`https://${hostname}`, { rejectUnauthorized: true })
    upstreamH2.on('error', () => { upstreamH2 = null })
    return upstreamH2
  }

  const fakeServer = new http.Server({ keepAlive: true, keepAliveTimeout: 30000 })

  // IMPORTANT: attach listener BEFORE emitting connection to avoid race condition
  fakeServer.on('request', async (clientReq: http.IncomingMessage, clientRes: http.ServerResponse) => {
    const reqPath = clientReq.url ?? '/'
    const method = clientReq.method ?? 'POST'
    const shouldIntercept = INTERCEPTED_PATHS.has(reqPath)

    console.log(`[squeezr/cursor] H1→H2: ${method} ${reqPath}${shouldIntercept ? ' [CHAT]' : ''}`)

    // Collect request body
    const chunks: Buffer[] = []
    clientReq.on('data', (chunk: Buffer) => chunks.push(chunk))
    clientReq.on('end', async () => {
      let body = Buffer.concat(chunks)

      // Compress if this is a chat endpoint
      if (shouldIntercept && method === 'POST' && body.length > 0) {
        cursorStats.requests++
        try {
          const frame = parseConnectFrame(body)
          if (frame && frame.flag === 0) {
            const { messages, otherFields } = extractConversation(frame.payload)
            if (messages.length > KEEP_RECENT + 1) {
              const compressibleCount = messages.length - KEEP_RECENT
              const compressibleMsgs = messages.slice(0, compressibleCount)
              const totalChars = compressibleMsgs.reduce((sum, m) => sum + m.text.length, 0)

              if (totalChars >= COMPRESS_THRESHOLD) {
                const textsToCompress = compressibleMsgs.map(m => m.text)
                let compressedTexts = textsToCompress.map(deterministicCompress)

                const compressed = new Map<number, string>()
                for (let i = 0; i < compressedTexts.length; i++) {
                  if (compressedTexts[i] !== textsToCompress[i]) {
                    compressed.set(i, compressedTexts[i])
                  }
                }

                if (compressed.size > 0) {
                  const filteredMessages = messages.filter((_, i) => !compressed.has(i) || compressed.get(i) !== '')
                  const newPayload = rebuildRequest(filteredMessages, otherFields, compressed)
                  const newFrame = buildConnectFrame(newPayload)
                  const charsSaved = totalChars - compressedTexts.join('').length
                  if (charsSaved > 0) {
                    cursorStats.compressed++
                    cursorStats.charsSaved += charsSaved
                    console.log(`[squeezr/cursor] Compressed: -${charsSaved} chars (${messages.length} msgs → ${filteredMessages.length})`)
                  }
                  body = newFrame as Buffer<ArrayBuffer>
                }
              }
            }
          }
        } catch (e: any) {
          console.error(`[squeezr/cursor] H1 compression error: ${e.message}`)
        }
      }

      // Forward to api2.cursor.sh over HTTP/2 (reusable session)
      const upSession = getUpstream()

      const upHeaders: Record<string, string> = {
        ':method': method,
        ':path': reqPath,
        ':authority': hostname,
        ':scheme': 'https',
      }

      for (const [k, v] of Object.entries(clientReq.headers)) {
        if (['host', 'connection', 'transfer-encoding', 'upgrade', 'proxy-connection'].includes(k)) continue
        upHeaders[k] = Array.isArray(v) ? v.join(', ') : (v ?? '')
      }
      upHeaders['content-length'] = String(body.length)

      const upStream = upSession.request(upHeaders)
      upStream.write(body)
      upStream.end()

      // Buffer response to get content-length for proper HTTP/1.1 keep-alive
      const respChunks: Buffer[] = []
      let respStatus = 200
      let respHeaders: Record<string, string> = {}

      upStream.on('response', (upRespHeaders) => {
        respStatus = (upRespHeaders[':status'] as number) ?? 200
        for (const [k, v] of Object.entries(upRespHeaders)) {
          if (k.startsWith(':')) continue
          respHeaders[k] = v as string
        }
      })

      upStream.on('data', (chunk: Buffer) => {
        respChunks.push(chunk)
      })

      upStream.on('end', () => {
        const respBody = Buffer.concat(respChunks)
        respHeaders['content-length'] = String(respBody.length)
        respHeaders['connection'] = 'keep-alive'
        clientRes.writeHead(respStatus, respHeaders)
        clientRes.end(respBody)
      })

      upStream.on('error', () => {
        if (!clientRes.headersSent) clientRes.writeHead(502, { 'connection': 'keep-alive' })
        clientRes.end()
      })
    })
  })

  fakeServer.on('error', () => { try { clientSocket.destroy() } catch {} })

  // Emit connection AFTER all listeners are attached
  fakeServer.emit('connection', clientSocket)
}

// ── HTTP/2 MITM handler for api2.cursor.sh ───────────────────────────────────

// realIp: when set, connect upstream directly by IP to avoid hosts-redirect loop
function handleCursorH2(
  clientSocket: tls.TLSSocket,
  hostname: string,
  realIp?: string,
) {
  // Use performServerHandshake to create an HTTP/2 session on the existing TLS socket
  let serverSession: any
  try {
    serverSession = (http2 as any).performServerHandshake(clientSocket)
  } catch (e: any) {
    console.log(`[squeezr/cursor] H2 handshake failed: ${e.message}`)
    clientSocket.destroy()
    return
  }

  serverSession.on('error', (e: Error) => {
    // Expected when client doesn't speak h2 — just close silently
    if (!e.message.includes('ECONNRESET')) {
      console.log(`[squeezr/cursor] H2 session error: ${e.message}`)
    }
  })

  serverSession.on('stream', (clientStream: http2.ServerHttp2Stream, clientHeaders: http2.IncomingHttpHeaders) => {
    const path = clientHeaders[':path'] as string || ''
    const method = clientHeaders[':method'] as string || 'POST'

    console.log(`[squeezr/cursor] H2 stream: ${method} ${path}`)
    const shouldIntercept = INTERCEPTED_PATHS.has(path)

    // Build upstream headers
    const upHeaders: Record<string, string | string[]> = {
      ':method': method, ':path': path, ':authority': hostname, ':scheme': 'https',
    }
    for (const [k, v] of Object.entries(clientHeaders)) {
      if (k.startsWith(':')) continue
      upHeaders[k] = v as string
    }

    // Create upstream session using pre-resolved IP (no async needed for transparent path)
    const upstreamUrl = realIp ? `https://${realIp}` : `https://${hostname}`
    const upstreamSession = http2.connect(upstreamUrl, { rejectUnauthorized: true, servername: hostname })
    upstreamSession.on('error', (err) => {
      console.error(`[squeezr/cursor] session error: ${err.message}`)
      try { clientStream.close(http2.constants.NGHTTP2_INTERNAL_ERROR) } catch {}
    })

    if (!shouldIntercept) {
      // ── Transparent proxy: pipe in real-time (no buffering) ──────────────
      const upStream = upstreamSession.request(upHeaders)
      clientStream.on('data', (chunk: Buffer) => { try { upStream.write(chunk) } catch {} })
      clientStream.on('end', () => { try { upStream.end() } catch {} })
      clientStream.on('error', () => { try { upStream.close() } catch {} })

      upStream.on('response', (upRespHeaders) => {
        const respHeaders: Record<string, string | string[]> = {}
        for (const [k, v] of Object.entries(upRespHeaders)) {
          if (k === ':status') continue; respHeaders[k] = v as string
        }
        try { clientStream.respond({ ':status': upRespHeaders[':status'] ?? 200, ...respHeaders }) } catch {}
      })
      upStream.on('data', (chunk: Buffer) => { try { clientStream.write(chunk) } catch {} })
      upStream.on('trailers', (t) => {
        try { const tr: Record<string, string> = {}; for (const [k, v] of Object.entries(t)) tr[k] = v as string; ;(clientStream as any).additionalHeaders(tr) } catch {}
      })
      upStream.on('end', () => { try { clientStream.end() } catch {} })
      upStream.on('error', (e) => {
        console.error(`[squeezr/cursor] transparent error: ${e.message}`)
        try { clientStream.close(http2.constants.NGHTTP2_INTERNAL_ERROR) } catch {}
      })
      return
    }

    // ── Intercepted path: buffer request, then compress + forward ────────────
    const chunks: Buffer[] = []
    let streamEnded = false
    let onStreamReady: (() => void) | null = null
    clientStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    clientStream.on('end', () => { streamEnded = true; if (onStreamReady) onStreamReady() })
    clientStream.on('error', () => { try { upstreamSession.close() } catch {} })

    ;(async () => {
      // Wait for full request body
      await new Promise<void>(resolve => {
        if (streamEnded) { resolve(); return }
        onStreamReady = resolve
      })
      const requestBuf = Buffer.concat(chunks)
      console.log(`[squeezr/cursor] intercepted ${path} body=${requestBuf.length}b`)

      // ── Intercepted chat path: compress and forward ────────────
      console.log(`[squeezr/cursor] intercepted ${path} requestBuf=${requestBuf.length}b headers=${JSON.stringify(Object.keys(upHeaders))}`)
      cursorStats.requests++

      // Log proto structure for AgentService/Run (payload is gzip-compressed)
      if (path === CURSOR_AGENT_RUN_PATH) {
        try {
          const frame = parseConnectFrame(requestBuf)
          if (frame) {
            const payload = isGzip(frame.payload) ? zlib.gunzipSync(frame.payload) : frame.payload
            const fields = parseProtoFields(payload)
            const summary = fields.slice(0, 10).map(f => `#${f.fieldNumber}(wt${f.wireType},${f.data.length}b)`).join(', ')
            console.log(`[squeezr/cursor] AgentRun decompressed(${payload.length}b) fields: ${summary}`)
            for (const f of fields.slice(0, 8)) {
              if (f.wireType === 2) {
                const inner = extractLengthDelimitedPayload(f.data)
                const innerFields = parseProtoFields(inner)
                const innerSummary = innerFields.slice(0, 8).map(fi => `#${fi.fieldNumber}(wt${fi.wireType},${fi.data.length}b)`).join(', ')
                console.log(`[squeezr/cursor]   #${f.fieldNumber}: ${innerSummary}`)
                // Go one level deeper for nested messages
                for (const fi of innerFields.slice(0, 5)) {
                  if (fi.wireType === 2) {
                    const inner2 = extractLengthDelimitedPayload(fi.data)
                    const inner2Fields = parseProtoFields(inner2)
                    const s2 = inner2Fields.slice(0, 6).map(f2 => `#${f2.fieldNumber}(wt${f2.wireType},${f2.data.length}b)`).join(', ')
                    // Print string fields (likely conversation text)
                    for (const f2 of inner2Fields) {
                      if (f2.wireType === 2) {
                        const txt = extractLengthDelimitedPayload(f2.data)
                        const str = txt.toString('utf-8')
                        if (str.length > 10 && str.length < 200 && /[\x20-\x7e]{10}/.test(str)) {
                          console.log(`[squeezr/cursor]     #${f.fieldNumber}.${fi.fieldNumber}.${f2.fieldNumber}: "${str.substring(0,100)}"`)
                        }
                      }
                    }
                    if (s2) console.log(`[squeezr/cursor]     #${f.fieldNumber}.${fi.fieldNumber}: ${s2}`)
                  }
                }
              }
            }
          }
        } catch (e: any) { console.log(`[squeezr/cursor] AgentRun parse error: ${e.message}`) }
      }

      try {
        // Parse ConnectRPC frame
        const frame = parseConnectFrame(requestBuf)
        if (!frame || frame.flag !== 0) {
          // Can't parse or gzip-compressed — pass through as-is
          forwardRaw(requestBuf, upHeaders, upstreamSession, clientStream)
          return
        }

        // Extract conversation from protobuf
        const { messages, otherFields } = extractConversation(frame.payload)

        if (messages.length <= KEEP_RECENT + 1) {
          // Not enough messages to compress — pass through
          forwardRaw(requestBuf, upHeaders, upstreamSession, clientStream)
          return
        }

        // Find messages to compress (all except the last KEEP_RECENT)
        const compressibleCount = messages.length - KEEP_RECENT
        const compressibleMsgs = messages.slice(0, compressibleCount)
        const totalChars = compressibleMsgs.reduce((sum, m) => sum + m.text.length, 0)

        if (totalChars < COMPRESS_THRESHOLD) {
          forwardRaw(requestBuf, upHeaders, upstreamSession, clientStream)
          return
        }

        // Extract bearer token and headers for compression call
        const bearerToken = (clientHeaders['authorization'] as string) || ''
        const fwdHeaders: Record<string, string> = {}
        for (const [k, v] of Object.entries(clientHeaders)) {
          if (!k.startsWith(':')) fwdHeaders[k] = v as string
        }

        // Try LLM compression first, fallback to deterministic
        const textsToCompress = compressibleMsgs.map(m => m.text)
        let compressedTexts: string[]

        if (bearerToken) {
          compressedTexts = await compressViaCursor(textsToCompress, bearerToken, fwdHeaders)
          // If LLM returned originals unchanged, fallback to deterministic
          const llmChanged = compressedTexts.length !== textsToCompress.length ||
            compressedTexts.some((t, i) => t !== textsToCompress[i])
          if (!llmChanged) {
            compressedTexts = textsToCompress.map(deterministicCompress)
          }
        } else {
          compressedTexts = textsToCompress.map(deterministicCompress)
        }

        // Build map of compressed messages
        const compressed = new Map<number, string>()
        if (compressedTexts.length === 1 && textsToCompress.length > 1) {
          // LLM returned a single summary — replace all compressible turns with one
          compressed.set(0, compressedTexts[0])
          // Mark rest for removal by setting empty text
          for (let i = 1; i < compressibleCount; i++) {
            compressed.set(i, '')
          }
        } else {
          // Per-message compression (deterministic fallback)
          for (let i = 0; i < compressedTexts.length; i++) {
            if (compressedTexts[i] !== textsToCompress[i]) {
              compressed.set(i, compressedTexts[i])
            }
          }
        }

        // Filter out empty messages
        const filteredMessages = messages.filter((_, i) => !compressed.has(i) || compressed.get(i) !== '')

        // Rebuild the protobuf
        const newPayload = rebuildRequest(filteredMessages, otherFields, compressed)
        const newFrame = buildConnectFrame(newPayload)

        const charsSaved = totalChars - compressedTexts.join('').length
        if (charsSaved > 0) {
          cursorStats.compressed++
          cursorStats.charsSaved += charsSaved
          console.log(`[squeezr/cursor] Compressed: -${charsSaved} chars (${messages.length} msgs → ${filteredMessages.length})`)
        }

        // Forward compressed request
        forwardRaw(newFrame as Buffer, upHeaders, upstreamSession, clientStream)
      } catch (err) {
        console.error(`[squeezr/cursor] compression error:`, err)
        forwardRaw(requestBuf, upHeaders, upstreamSession, clientStream)
      }
    })()  // end async IIFE
  })

  serverSession.on('error', () => {})
}

function forwardRaw(
  body: Buffer,
  headers: Record<string, string | string[]>,
  upstreamSession: http2.ClientHttp2Session,
  clientStream: http2.ServerHttp2Stream,
) {
  const upHeaders = { ...headers, 'content-length': String(body.length) }

  const upStream = upstreamSession.request(upHeaders)
  upStream.write(body)
  upStream.end()

  let bytesForwarded = 0, chunksForwarded = 0

  upStream.on('response', (upRespHeaders) => {
    const status = upRespHeaders[':status'] ?? 200
    console.log(`[squeezr/cursor] fwd response status=${status}`)
    const respHeaders: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(upRespHeaders)) {
      if (k === ':status') continue
      respHeaders[k] = v as string
    }
    try { clientStream.respond({ ':status': status, ...respHeaders }) }
    catch (e: any) { console.error(`[squeezr/cursor] respond error: ${e.message}`) }
  })

  upStream.on('data', (chunk: Buffer) => {
    bytesForwarded += chunk.length; chunksForwarded++
    if (chunksForwarded <= 3) console.log(`[squeezr/cursor] fwd chunk #${chunksForwarded} ${chunk.length}b`)
    try { clientStream.write(chunk) } catch {}
  })

  upStream.on('trailers', (trailerHeaders) => {
    console.log(`[squeezr/cursor] fwd trailers: ${JSON.stringify(trailerHeaders)}`)
    try {
      const trailers: Record<string, string> = {}
      for (const [k, v] of Object.entries(trailerHeaders)) trailers[k] = v as string
      ;(clientStream as any).additionalHeaders(trailers)
    } catch {}
  })

  upStream.on('end', () => {
    console.log(`[squeezr/cursor] fwd end — ${chunksForwarded} chunks ${bytesForwarded}b`)
    try { clientStream.end() } catch {}
  })

  upStream.on('error', (e) => {
    console.error(`[squeezr/cursor] fwd upstream error: ${e.message}`)
    try { clientStream.close(http2.constants.NGHTTP2_INTERNAL_ERROR) } catch {}
  })
  clientStream.on('error', () => { try { upStream.close() } catch {} })
}

// ── Local TLS server for MITM ────────────────────────────────────────────────

const tlsServerCache = new Map<string, { port: number; server: tls.Server }>()

function getOrCreateTlsServer(hostname: string, realIp?: string): Promise<number> {
  const cached = tlsServerCache.get(hostname)
  if (cached) return Promise.resolve(cached.port)

  return new Promise((resolve, reject) => {
    const { key, cert } = getCert(hostname)
    let tcpCount = 0
    let tlsCount = 0
    const server = tls.createServer({
      key,
      cert,
      ALPNProtocols: ['h2', 'http/1.1'],
    }, (socket) => {
      tlsCount++
      const protocol = socket.alpnProtocol
      console.log(`[squeezr/cursor] TLS #${tlsCount} ALPN=${protocol} (${tcpCount} tcp total)`)
      if (protocol === 'h2') {
        handleCursorH2(socket, hostname, realIp)
      } else {
        // HTTP/1.1 or no ALPN — transparent tunnel to real api2.cursor.sh (no MITM)
        const connectHost = realIp ?? hostname
        const upstream = tls.connect(443, connectHost, { servername: hostname }, () => {
          socket.pipe(upstream)
          upstream.pipe(socket)
        })
        upstream.on('error', () => { try { socket.destroy() } catch {} })
        socket.on('error', () => { try { upstream.destroy() } catch {} })
      }
    })
    server.on('connection', () => { tcpCount++ })
    server.on('tlsClientError', () => {}) // suppress idle connection errors
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo
      tlsServerCache.set(hostname, { port: addr.port, server })
      resolve(addr.port)
    })
  })
}

// ── CONNECT handler ──────────────────────────────────────────────────────────

function handleConnect(req: http.IncomingMessage, clientSocket: net.Socket, _head: Buffer) {
  const [hostname, portStr] = (req.url ?? '').split(':')
  const port = parseInt(portStr) || 443

  console.log(`[squeezr/cursor] CONNECT ${hostname}:${port}`)

  // Only MITM api2.cursor.sh — everything else transparent tunnel
  if (hostname !== CURSOR_API_HOST) {
    const upstream = net.connect(port, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on('error', (e) => { console.log(`[squeezr/cursor] tunnel error ${hostname}: ${e.message}`); try { clientSocket.destroy() } catch {} })
    clientSocket.on('error', () => { try { upstream.destroy() } catch {} })
    return
  }

  // MITM api2.cursor.sh — route through local TLS server
  getOrCreateTlsServer(hostname).then((localPort) => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    const local = net.connect(localPort, '127.0.0.1', () => {
      clientSocket.pipe(local)
      local.pipe(clientSocket)
    })
    local.on('error', () => { try { clientSocket.destroy() } catch {} })
    clientSocket.on('error', () => { try { local.destroy() } catch {} })
  }).catch(() => {
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    clientSocket.destroy()
  })
}

// ── Plain HTTP handler ───────────────────────────────────────────────────────

function handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ status: 'ok', type: 'cursor-mitm-proxy', stats: getCursorStats() }))
}

// ── Server lifecycle ─────────────────────────────────────────────────────────

let cursorServer: http.Server | null = null
const CURSOR_MITM_PORT = config.mitmPort + 1  // default: 8082

export function getCursorMitmPort() { return CURSOR_MITM_PORT }

export function startCursorMitm(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Verify CA exists (codexMitm should have created it already)
    if (!fs.existsSync(CA_KEY_PATH) || !fs.existsSync(CA_CERT_PATH)) {
      console.error('[squeezr/cursor] CA not found. Run `squeezr setup` first.')
      reject(new Error('CA not found'))
      return
    }

    cursorServer = http.createServer(handleHttp)
    cursorServer.on('connect', handleConnect)
    cursorServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[squeezr/cursor] Port ${CURSOR_MITM_PORT} in use`)
        reject(err)
      } else {
        console.error('[squeezr/cursor] error:', err.message)
      }
    })
    cursorServer.listen(CURSOR_MITM_PORT, () => {
      console.log(`[squeezr/cursor] MITM proxy on http://localhost:${CURSOR_MITM_PORT}`)
      console.log(`[squeezr/cursor] Intercepting: ${CURSOR_API_HOST} (chat, composer, agent)`)
      resolve()
    })
  })
}

export function stopCursorMitm() {
  cursorServer?.close()
  cursorServer = null
  for (const [, entry] of tlsServerCache) {
    try { entry.server.close() } catch {}
  }
  tlsServerCache.clear()
}

// ── Hosts-redirect mode ───────────────────────────────────────────────────────
// OS-level interception: 127.0.0.1 api2.cursor.sh in hosts file + portproxy
// This cannot be bypassed by Cursor regardless of its HTTP client implementation.

const HOSTS_FILE = platform() === 'win32'
  ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
  : '/etc/hosts'
const HOSTS_MARKER = '# squeezr-cursor-mitm'
const DIRECT_TLS_PORT = 8443  // squeezr listens here; portproxy maps 443 → 8443

let directTlsServer: tls.Server | null = null

/** Resolve real IPs for all intercepted hosts BEFORE we redirect hosts */
export async function resolveRealIps(): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>()
  for (const host of ALL_CURSOR_HOSTS) {
    try {
      const ips = await dns.resolve4(host)
      results.set(host, ips)
      console.log(`[squeezr/cursor] Resolved ${host}: ${ips.join(', ')}`)
    } catch (e: any) {
      console.warn(`[squeezr/cursor] Could not resolve ${host}: ${e.message}`)
    }
  }
  if (results.size === 0) throw new Error('Could not resolve any Cursor hosts')
  return results
}

/** Add hosts entries for all intercepted hosts (requires admin on Windows) */
export function addHostsEntry(): void {
  const content = fs.readFileSync(HOSTS_FILE, 'utf-8')
  const lines: string[] = []
  for (const host of ALL_CURSOR_HOSTS) {
    const marker = `${HOSTS_MARKER}-${host}`
    if (!content.includes(marker)) {
      lines.push(`127.0.0.1 ${host} ${marker}`)
    }
  }
  if (lines.length === 0) return  // already added
  fs.appendFileSync(HOSTS_FILE, '\n' + lines.join('\n') + '\n', 'utf-8')
  console.log(`[squeezr/cursor] Added hosts entries for ${lines.length} hosts`)
}

/** Remove hosts entries */
export function removeHostsEntry(): void {
  try {
    const content = fs.readFileSync(HOSTS_FILE, 'utf-8')
    const filtered = content
      .split('\n')
      .filter(line => !line.includes(HOSTS_MARKER))
      .join('\n')
    fs.writeFileSync(HOSTS_FILE, filtered, 'utf-8')
    console.log(`[squeezr/cursor] Removed hosts entries`)
  } catch (e: any) {
    console.error(`[squeezr/cursor] Could not remove hosts entries: ${e.message}`)
  }
}

/** Setup portproxy 443 → 8443 (Windows, requires admin) */
export function setupPortProxy(): void {
  if (platform() !== 'win32') return
  try {
    execSync(
      `netsh interface portproxy add v4tov4 listenport=443 listenaddress=127.0.0.1 connectport=${DIRECT_TLS_PORT} connectaddress=127.0.0.1`,
      { stdio: 'pipe' }
    )
    console.log(`[squeezr/cursor] portproxy: 127.0.0.1:443 → 127.0.0.1:${DIRECT_TLS_PORT}`)
  } catch (e: any) {
    // May already exist — check
    try {
      const out = execSync('netsh interface portproxy show v4tov4', { encoding: 'utf-8' })
      if (out.includes('127.0.0.1') && out.includes('443')) {
        console.log(`[squeezr/cursor] portproxy already configured`)
        return
      }
    } catch {}
    throw new Error(`Could not setup portproxy (need admin?): ${e.message}`)
  }
}

/** Remove portproxy */
export function removePortProxy(): void {
  if (platform() !== 'win32') return
  try {
    execSync(
      `netsh interface portproxy delete v4tov4 listenport=443 listenaddress=127.0.0.1`,
      { stdio: 'pipe' }
    )
    console.log(`[squeezr/cursor] portproxy removed`)
  } catch {}
}

/** Start direct TLS H2 server on DIRECT_TLS_PORT, supporting multiple hostnames via SNI */
export function startDirectTlsServer(realIpMap: Map<string, string[]> | string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (directTlsServer) { resolve(); return }

    // Accept legacy string arg (single IP for api2 only) or new Map
    const ipMap: Map<string, string> = new Map()
    if (typeof realIpMap === 'string') {
      ipMap.set(CURSOR_API_HOST, realIpMap)
    } else {
      for (const [host, ips] of realIpMap) {
        if (ips.length > 0) ipMap.set(host, ips[0])
      }
    }

    // Default cert (used if SNI doesn't match)
    const defaultHost = CURSOR_API_HOST
    const { key: defaultKey, cert: defaultCert } = getCert(defaultHost)

    directTlsServer = tls.createServer({
      key: defaultKey,
      cert: defaultCert,
      ALPNProtocols: ['h2', 'http/1.1'],
      SNICallback: (hostname, cb) => {
        const { key, cert } = getCert(hostname)
        cb(null, tls.createSecureContext({ key, cert }))
      },
    }, (socket) => {
      const hostname = (socket as any).servername || defaultHost
      const realIp = ipMap.get(hostname) || ipMap.get(defaultHost) || ''
      const protocol = socket.alpnProtocol
      console.log(`[squeezr/cursor] direct TLS ALPN=${protocol} host=${hostname}`)
      if (protocol === 'h2') {
        handleCursorH2(socket, hostname, realIp)
      } else {
        const upstream = tls.connect(443, realIp || hostname, { servername: hostname }, () => {
          socket.pipe(upstream)
          upstream.pipe(socket)
        })
        upstream.on('error', () => { try { socket.destroy() } catch {} })
        socket.on('error', () => { try { upstream.destroy() } catch {} })
      }
    })

    directTlsServer.on('tlsClientError', () => {})
    directTlsServer.on('error', reject)
    directTlsServer.listen(DIRECT_TLS_PORT, '127.0.0.1', () => {
      console.log(`[squeezr/cursor] direct TLS server on 127.0.0.1:${DIRECT_TLS_PORT} (${ipMap.size} hosts)`)
      resolve()
    })
  })
}

export function stopDirectTlsServer(): void {
  directTlsServer?.close()
  directTlsServer = null
}

export function getDirectTlsPort(): number {
  return DIRECT_TLS_PORT
}
