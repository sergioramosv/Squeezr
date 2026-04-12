/**
 * Circuit breaker for AI compression calls.
 *
 * Prevents hammering a down backend (Haiku, GPT-4o-mini, etc.)
 * with repeated failing requests. After N consecutive failures,
 * the circuit opens and all AI compression is skipped for a cooldown
 * period, then a single probe is allowed to test recovery.
 *
 * States:
 *   closed    → normal operation, AI compression enabled
 *   open      → backend down, all AI calls skipped (passthrough)
 *   half-open → cooldown elapsed, allow one probe call
 */

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerConfig {
  failureThreshold: number   // consecutive failures before opening
  resetTimeoutMs: number     // how long to stay open before half-open probe
  callTimeoutMs: number      // per-call timeout for AI compression
}

export interface CircuitSnapshot {
  state: CircuitState
  consecutive_failures: number
  last_failure_time: number | null
  last_success_time: number | null
  total_trips: number
  config: CircuitBreakerConfig
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  callTimeoutMs: 5_000,
}

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private consecutiveFailures = 0
  private lastFailureTime: number | null = null
  private lastSuccessTime: number | null = null
  private totalTrips = 0
  private config: CircuitBreakerConfig

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /** Returns current state, transitioning open→half-open if cooldown elapsed. */
  getState(): CircuitState {
    if (
      this.state === 'open' &&
      this.lastFailureTime !== null &&
      Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs
    ) {
      this.state = 'half-open'
      console.log('[squeezr] Circuit breaker → HALF-OPEN (probing)')
    }
    return this.state
  }

  /** Whether the next AI call should be attempted. */
  shouldAllow(): boolean {
    return this.getState() !== 'open'
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      console.log('[squeezr] Circuit breaker → CLOSED (backend recovered)')
    }
    this.consecutiveFailures = 0
    this.state = 'closed'
    this.lastSuccessTime = Date.now()
  }

  recordFailure(): void {
    this.consecutiveFailures++
    this.lastFailureTime = Date.now()

    if (this.consecutiveFailures >= this.config.failureThreshold && this.state !== 'open') {
      this.state = 'open'
      this.totalTrips++
      console.log(
        `[squeezr] Circuit breaker → OPEN (${this.consecutiveFailures} consecutive failures, ` +
        `cooldown ${this.config.resetTimeoutMs / 1000}s)`
      )
    }
  }

  /** Wraps an async AI call with timeout and circuit logic. */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.shouldAllow()) {
      throw new Error('Circuit breaker is open — AI compression skipped')
    }

    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AI compression timeout')), this.config.callTimeoutMs)
        ),
      ])
      this.recordSuccess()
      return result
    } catch (err) {
      this.recordFailure()
      throw err
    }
  }

  snapshot(): CircuitSnapshot {
    return {
      state: this.getState(),
      consecutive_failures: this.consecutiveFailures,
      last_failure_time: this.lastFailureTime,
      last_success_time: this.lastSuccessTime,
      total_trips: this.totalTrips,
      config: this.config,
    }
  }
}

/** Singleton circuit breaker for all AI compression backends. */
export const circuitBreaker = new CircuitBreaker()
