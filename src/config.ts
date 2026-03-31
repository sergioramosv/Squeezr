import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { parse } from 'smol-toml'

const TOML_PATH = join(import.meta.dirname, '..', 'squeezr.toml')

interface TomlConfig {
  proxy?: { port?: number }
  compression?: {
    threshold?: number
    keep_recent?: number
    disabled?: boolean
    compress_system_prompt?: boolean
    compress_conversation?: boolean
  }
  cache?: { enabled?: boolean; max_entries?: number }
  adaptive?: {
    enabled?: boolean
    low_threshold?: number
    mid_threshold?: number
    high_threshold?: number
    critical_threshold?: number
  }
  local?: {
    enabled?: boolean
    upstream_url?: string
    compression_model?: string
    dummy_keys?: string[]
  }
}

function loadToml(): TomlConfig {
  if (!existsSync(TOML_PATH)) return {}
  try {
    return parse(readFileSync(TOML_PATH, 'utf-8')) as TomlConfig
  } catch {
    return {}
  }
}

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback
}

export class Config {
  readonly port: number
  readonly threshold: number
  readonly keepRecent: number
  readonly disabled: boolean
  readonly compressSystemPrompt: boolean
  readonly compressConversation: boolean
  readonly dryRun: boolean
  readonly cacheEnabled: boolean
  readonly cacheMaxEntries: number
  readonly adaptiveEnabled: boolean
  readonly adaptiveLow: number
  readonly adaptiveMid: number
  readonly adaptiveHigh: number
  readonly adaptiveCritical: number
  readonly localEnabled: boolean
  readonly localUpstreamUrl: string
  readonly localCompressionModel: string
  readonly localDummyKeys: Set<string>

  constructor() {
    const t = loadToml()
    const p = t.proxy ?? {}
    const c = t.compression ?? {}
    const ca = t.cache ?? {}
    const ad = t.adaptive ?? {}
    const lo = t.local ?? {}

    this.port = parseInt(env('SQUEEZR_PORT', String(p.port ?? 8080)))
    this.threshold = parseInt(env('SQUEEZR_THRESHOLD', String(c.threshold ?? 800)))
    this.keepRecent = parseInt(env('SQUEEZR_KEEP_RECENT', String(c.keep_recent ?? 3)))
    this.disabled = env('SQUEEZR_DISABLED', String(c.disabled ?? false)) === '1' || env('SQUEEZR_DISABLED', '') === 'true'
    this.compressSystemPrompt = c.compress_system_prompt ?? true
    this.compressConversation = c.compress_conversation ?? false
    this.dryRun = env('SQUEEZR_DRY_RUN', '') === '1'
    this.cacheEnabled = ca.enabled ?? true
    this.cacheMaxEntries = ca.max_entries ?? 1000
    this.adaptiveEnabled = ad.enabled ?? true
    this.adaptiveLow = ad.low_threshold ?? 1500
    this.adaptiveMid = ad.mid_threshold ?? 800
    this.adaptiveHigh = ad.high_threshold ?? 400
    this.adaptiveCritical = ad.critical_threshold ?? 150
    this.localEnabled = lo.enabled ?? true
    this.localUpstreamUrl = env('SQUEEZR_LOCAL_UPSTREAM', lo.upstream_url ?? 'http://localhost:11434')
    this.localCompressionModel = env('SQUEEZR_LOCAL_MODEL', lo.compression_model ?? 'qwen2.5-coder:1.5b')
    const rawDummies = lo.dummy_keys ?? ['ollama', 'lm-studio', 'sk-no-key-required', 'local', 'none', '']
    this.localDummyKeys = new Set(rawDummies.map(k => k.toLowerCase()))
  }

  thresholdForPressure(pressure: number): number {
    if (!this.adaptiveEnabled) return this.threshold
    if (pressure >= 0.90) return this.adaptiveCritical
    if (pressure >= 0.75) return this.adaptiveHigh
    if (pressure >= 0.50) return this.adaptiveMid
    return this.adaptiveLow
  }

  isLocalKey(key: string): boolean {
    if (!this.localEnabled) return false
    const k = key.trim().toLowerCase()
    return this.localDummyKeys.has(k) || (k.length > 0 && !k.startsWith('sk-') && !k.startsWith('aiza'))
  }
}

export const config = new Config()
