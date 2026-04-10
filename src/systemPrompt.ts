import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CACHE_FILE = join(homedir(), '.squeezr', 'sysprompt_cache.json')
const MIN_LENGTH = 2000

const PROMPT =
  'Compress this AI assistant system prompt to under 600 tokens. ' +
  'Keep: tool names, behavioral rules, key constraints, critical instructions. ' +
  'Remove: verbose examples, repetitive explanations, formatting guides, long documentation. ' +
  'Output only the compressed prompt.'

function cacheKey(text: string): string {
  return createHash('md5').update(text).digest('hex')
}

function loadCache(): Record<string, string> {
  try {
    if (existsSync(CACHE_FILE)) return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'))
  } catch { /* ignore */ }
  return {}
}

function saveCache(cache: Record<string, string>): void {
  try {
    const dir = join(homedir(), '.squeezr')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch { /* ignore */ }
}

export async function compressSystemPrompt(
  prompt: string,
  apiKey: string,
  backend: 'haiku' | 'gpt-mini' | 'gemini-flash' | 'ollama',
): Promise<{ text: string; originalLen: number; compressedLen: number }> {
  if (!prompt || prompt.length < MIN_LENGTH) return { text: prompt, originalLen: prompt.length, compressedLen: prompt.length }

  const cache = loadCache()
  const key = cacheKey(prompt)
  if (cache[key]) return { text: cache[key], originalLen: prompt.length, compressedLen: cache[key].length }

  try {
    let compressed: string
    const input = `${PROMPT}\n\n---\n${prompt.slice(0, 10000)}`

    if (backend === 'haiku') {
      const authOpts = apiKey.startsWith('sk-') ? { apiKey } : { authToken: apiKey }
      const client = new Anthropic(authOpts)
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        messages: [{ role: 'user', content: input }],
      })
      compressed = (resp.content[0] as { text: string }).text
    } else if (backend === 'gpt-mini') {
      const client = new OpenAI({ apiKey })
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 700,
        messages: [{ role: 'user', content: input }],
      })
      compressed = resp.choices[0].message.content ?? prompt
    } else if (backend === 'gemini-flash') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-8b:generateContent?key=${apiKey}`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: input }] }] }),
      })
      const data = (await resp.json()) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
      compressed = data.candidates[0].content.parts[0].text
    } else {
      return { text: prompt, originalLen: prompt.length, compressedLen: prompt.length } // ollama: skip
    }

    const ratio = Math.round((1 - compressed.length / prompt.length) * 100)
    console.log(`[squeezr/${backend}] System prompt compressed: -${ratio}% (${prompt.length.toLocaleString()} → ${compressed.length.toLocaleString()} chars) [cached]`)
    cache[key] = compressed
    saveCache(cache)
    return { text: compressed, originalLen: prompt.length, compressedLen: compressed.length }
  } catch {
    return { text: prompt, originalLen: prompt.length, compressedLen: prompt.length }
  }
}
