// The prompt cache's clock, as Claude Code's own /usage "Prompt cache (main)" line
// computes it: the cache goes cold one TTL after the last main request was sent.

export type Ttl = '5m' | '1h'

export type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model: string
}

export type CacheState = {
  readonly hasTurn: boolean
  readonly anchorAt?: number
  readonly ttl?: Ttl
  readonly basisTokens?: number
  readonly model?: string
  readonly speed?: string
  readonly geo?: string
  readonly warnedFor?: number
}

export type TranscriptInfo = { model: string; ttl?: Ttl; speed?: string; geo?: string }

export type CacheView =
  | { kind: 'none'; ttlLabel: string }
  | { kind: 'warm'; ttlLabel: string; remainingMs: number; isWarning: boolean }
  | { kind: 'cold'; ttlLabel: string }

export const WARN_MS = 300_000
export const INITIAL_STATE: CacheState = { hasTurn: false }

const TTL_MS: Readonly<Record<Ttl, number>> = { '5m': 300_000, '1h': 3_600_000 }

export function defaultMinutesOf(options: Readonly<Record<string, unknown>>): number {
  const minutes = options.default_cache_minutes
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    throw new Error('cache-keeper: default_cache_minutes must be a whole number from 1 to 60')
  }
  return minutes
}

export function onStep(s: CacheState, sentAt: number, usage: StepUsage): CacheState {
  const basisTokens = usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  return { ...s, hasTurn: true, anchorAt: sentAt, model: usage.model, basisTokens }
}

export function onReset(s: CacheState): CacheState {
  return { ...s, hasTurn: false, anchorAt: undefined, basisTokens: undefined }
}

export function onResume(
  s: CacheState,
  now: number,
  e: { seconds_since_last_response?: number; context_tokens?: number; model?: string },
): CacheState {
  const seconds = e.seconds_since_last_response
  return {
    ...s,
    hasTurn: false,
    anchorAt: seconds === undefined ? undefined : now - seconds * 1_000,
    basisTokens: e.context_tokens,
    model: e.model ?? s.model,
  }
}

export function onModelSwitch(s: CacheState, e: { to_model: string; cache_ttl: Ttl; context_tokens: number }): CacheState {
  return { ...s, anchorAt: undefined, model: e.to_model, ttl: e.cache_ttl, basisTokens: e.context_tokens }
}

export function onTranscript(s: CacheState, info: TranscriptInfo): CacheState {
  return { ...s, ttl: info.ttl ?? s.ttl, speed: info.speed ?? s.speed, geo: info.geo ?? s.geo }
}

export function onWarned(s: CacheState): CacheState {
  return { ...s, warnedFor: s.anchorAt }
}

export function ttlMsOf(s: CacheState, defaultMinutes: number): number {
  return s.ttl === undefined ? defaultMinutes * 60_000 : TTL_MS[s.ttl]
}

export function pricingTtlOf(s: CacheState, defaultMinutes: number): Ttl {
  return s.ttl ?? (defaultMinutes > 5 ? '1h' : '5m')
}

export function cacheView(s: CacheState, now: number, defaultMinutes: number): CacheView {
  const ttlLabel = s.ttl === undefined ? `${defaultMinutes}m set` : `${s.ttl} detected`
  if (s.basisTokens === undefined) return { kind: 'none', ttlLabel }
  if (s.anchorAt === undefined) return { kind: 'cold', ttlLabel }
  const ttlMs = ttlMsOf(s, defaultMinutes)
  const remainingMs = s.anchorAt + ttlMs - now
  if (remainingMs <= 0) return { kind: 'cold', ttlLabel }
  return { kind: 'warm', ttlLabel, remainingMs, isWarning: ttlMs > WARN_MS && remainingMs <= WARN_MS }
}

export function shouldWarn(s: CacheState, view: CacheView): boolean {
  return view.kind === 'warm' && view.isWarning && s.warnedFor !== s.anchorAt
}
