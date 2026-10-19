import type { BoxProps, ButtonProps, ElementConstructor, RenderElement, TextProps } from 'claude-code'
import type { CacheState, CacheView } from './cache-clock.ts'
import { cacheView, pricingTtlOf } from './cache-clock.ts'
import { formatCountdown, formatDuration, formatTokens, formatUsd } from './format.ts'
import { recacheUsd } from './pricing.ts'
import type { ContextFigures, Threshold } from './threshold.ts'
import { isOverThreshold, shortThresholdText } from './threshold.ts'

// What the strip above the prompt shows, and the text of the cold-cache and quality warnings.

export type UsageSnapshot = {
  readonly context?: ContextFigures
  readonly rateLimits: readonly { readonly kind: string; readonly percentUsed: number; readonly resetsAt?: string }[]
  readonly cost?: { readonly usd: number }
}

export type Recache = { kind: 'usd'; usd: number } | { kind: 'unpriced'; model: string }

type Limit = { percentUsed: number; resetsInMs?: number }

export type BandModel = {
  view: CacheView
  recache?: Recache
  context?: { tokens: number; percent?: number }
  fiveHour?: Limit
  week?: Limit
  costUsd?: number
  isOverThreshold: boolean
  button: 'hidden' | 'ready' | 'writing'
  fresh: 'hidden' | 'ready' | 'confirm'
}

export type Segment = { label: string; value: string; color?: 'success' | 'warning' | 'error'; note?: string }

export type BandElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

export function recacheOf(cache: CacheState, defaultMinutes: number): Recache | undefined {
  if (cache.basisTokens === undefined) return undefined
  const model = cache.model ?? 'unknown model'
  const usd = recacheUsd({
    model,
    tokens: cache.basisTokens,
    ttl: pricingTtlOf(cache, defaultMinutes),
    speed: cache.speed,
    geo: cache.geo,
  })
  return usd === undefined ? { kind: 'unpriced', model } : { kind: 'usd', usd }
}

export function bandModelOf(i: {
  cache: CacheState
  usage?: UsageSnapshot
  now: number
  defaultMinutes: number
  isWorking: boolean
  handoffRunning: boolean
  threshold: Threshold
  freshArmed: boolean
}): BandModel {
  const tokens = i.usage?.context?.tokens
  const isOver = isOverThreshold(i.threshold, i.usage?.context)
  const button = i.handoffRunning ? 'writing' : i.isWorking || !i.cache.hasTurn ? 'hidden' : 'ready'
  return {
    view: cacheView(i.cache, i.now, i.defaultMinutes),
    recache: recacheOf(i.cache, i.defaultMinutes),
    context: tokens === undefined ? undefined : { tokens, percent: i.usage?.context?.percent },
    fiveHour: limitOf(i.usage, 'five_hour', i.now),
    week: limitOf(i.usage, 'seven_day', i.now),
    costUsd: i.usage?.cost?.usd,
    isOverThreshold: isOver,
    button,
    fresh: !isOver || button !== 'ready' ? 'hidden' : i.freshArmed ? 'confirm' : 'ready',
  }
}

export function segmentsOf(m: BandModel): Segment[] {
  return [
    cacheSegment(m.view),
    { label: 'ctx', value: m.context === undefined ? '--' : contextText(m.context), ...(m.isOverThreshold ? QUALITY_NOTE : {}) },
    { label: '5h', value: limitText(m.fiveHour) },
    { label: 'wk', value: limitText(m.week) },
    { label: 'session', value: m.costUsd === undefined ? '--' : formatUsd(m.costUsd) },
    { label: m.view.kind === 'cold' ? 'next msg' : 'if cold', value: recacheText(m.recache) },
  ]
}

export function bandTree(el: BandElements, m: BandModel, onHandoff: () => Promise<void>, onFresh: () => Promise<void>): RenderElement {
  const children = segmentsOf(m).map((s) => segmentTree(el, s))
  if (m.button === 'ready') {
    children.push(el.Button({ key: 'handoff', label: 'New session with handoff', hotkey: 'h', plain: true, onPress: () => onHandoff() }))
  }
  if (m.button === 'writing') {
    children.push(el.Text({ dimColor: true, children: ['writing handoff brief...'] }))
  }
  if (m.fresh !== 'hidden') {
    const label = m.fresh === 'confirm' ? 'Confirm fresh session' : 'Fresh session'
    children.push(el.Button({ key: 'fresh', label, hotkey: 'f', plain: true, onPress: () => onFresh() }))
  }
  return el.Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children })
}

export function warningMessage(project: string, recache: Recache | undefined): { title: string; body: string } {
  const cost = recache?.kind === 'usd' ? `Re-caching after that costs ${formatUsd(recache.usd)}. ` : ''
  return {
    title: `Cache Keeper: ${project}`,
    body: `Prompt cache goes cold in 5 min. ${cost}Send a message to keep it warm, or use New session with handoff.`,
  }
}

export function qualityToastText(context: { tokens: number; percent?: number }, threshold: Threshold): string {
  const percent = context.percent === undefined ? '' : ` (${context.percent}%)`
  return `Context is ${formatTokens(context.tokens)} tokens${percent}, past your ${shortThresholdText(threshold)} threshold. Answers may start to slip: consider New session with handoff or Fresh session, above the prompt.`
}

const QUALITY_NOTE = { color: 'warning', note: 'quality may slip' } as const

function limitOf(usage: UsageSnapshot | undefined, kind: string, now: number): Limit | undefined {
  const limit = usage?.rateLimits.find((l) => l.kind === kind)
  if (limit === undefined) return undefined
  return {
    percentUsed: limit.percentUsed,
    resetsInMs: limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt) - now,
  }
}

function cacheSegment(view: CacheView): Segment {
  switch (view.kind) {
    case 'none':
      return { label: 'cache', value: '--:--', note: view.ttlLabel }
    case 'cold':
      return { label: 'cache', value: 'cold', color: 'error' }
    case 'warm':
      return {
        label: 'cache',
        value: formatCountdown(view.remainingMs),
        color: view.isWarning ? 'warning' : 'success',
        note: view.ttlLabel,
      }
  }
}

function contextText(context: { tokens: number; percent?: number }): string {
  return context.percent === undefined ? formatTokens(context.tokens) : `${formatTokens(context.tokens)} ${context.percent}%`
}

function limitText(limit: Limit | undefined): string {
  if (limit === undefined) return '--'
  const resets = limit.resetsInMs !== undefined && limit.resetsInMs > 0 ? ` ↻${formatDuration(limit.resetsInMs)}` : ''
  return `${Math.round(limit.percentUsed)}%${resets}`
}

function recacheText(recache: Recache | undefined): string {
  if (recache === undefined) return '--'
  return recache.kind === 'usd' ? formatUsd(recache.usd) : `no price for ${recache.model}`
}

function segmentTree(el: BandElements, s: Segment): RenderElement {
  const cells = [
    el.Text({ dimColor: true, children: [s.label] }),
    el.Text({ ...(s.color === undefined ? {} : { color: s.color }), children: [s.value] }),
  ]
  if (s.note !== undefined) cells.push(el.Text({ dimColor: true, children: [s.note] }))
  return el.Box({ key: s.label, flexDirection: 'row', columnGap: 1, children: cells })
}
