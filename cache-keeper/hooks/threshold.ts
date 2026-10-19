import { formatTokens } from './format.ts'

// The handoff threshold: the conversation size past which answers may start to slip.
// The quality warning and automatic handoff both use it, /autohandoff sets it, and
// it is kept in the mod's store across sessions.

export type Threshold = { readonly kind: 'percent'; readonly value: number } | { readonly kind: 'tokens'; readonly value: number }

export type AutoSetting = { readonly isOn: boolean; readonly threshold: Threshold }

export type ContextFigures = { readonly tokens?: number; readonly window?: number; readonly percent?: number }

export type AutoCommand = { kind: 'show' } | { kind: 'set'; setting: AutoSetting } | { kind: 'error'; text: string }

export const STORE_KEY = 'autoHandoff'
export const DEFAULT_SETTING: AutoSetting = { isOn: false, threshold: { kind: 'percent', value: 50 } }

const MIN_TOKENS = 1_000
const MAX_TOKENS = 10_000_000
const USAGE = 'Use /autohandoff on, /autohandoff off, or a threshold such as 50% or 200k.'

export function isOverThreshold(t: Threshold, context: ContextFigures | undefined): boolean {
  const tokens = context?.tokens
  if (t.kind === 'tokens') return tokens !== undefined && tokens >= t.value
  const window = context?.window
  // The reported percent is rounded, so 499,999 of 1M would read 50%.
  if (tokens !== undefined && window !== undefined && window > 0) return tokens * 100 >= t.value * window
  return context?.percent !== undefined && context.percent >= t.value
}

export function thresholdText(t: Threshold): string {
  return t.kind === 'percent' ? `${t.value}% of the context window` : `${formatTokens(t.value)} tokens`
}

export function shortThresholdText(t: Threshold): string {
  return t.kind === 'percent' ? `${t.value}%` : formatTokens(t.value)
}

export function parseAutoArgs(args: string, current: AutoSetting): AutoCommand {
  const text = args.trim().toLowerCase()
  if (text === '') return { kind: 'show' }
  if (text === 'on' || text === 'off') return { kind: 'set', setting: { ...current, isOn: text === 'on' } }
  const match = /^(\d+(?:\.\d+)?)\s*(%|k|m)?$/.exec(text)
  if (match === null) return { kind: 'error', text: `Cache Keeper did not understand "${args.trim()}". ${USAGE}` }
  const value = Number(match[1])
  const unit = match[2]
  if (unit === '%') {
    if (!(value >= 1 && value <= 100)) return { kind: 'error', text: 'A percentage threshold must be from 1% to 100%.' }
    return { kind: 'set', setting: { isOn: true, threshold: { kind: 'percent', value } } }
  }
  if (unit === undefined && value < MIN_TOKENS) {
    return { kind: 'error', text: `"${match[1]}" has no unit. Type ${match[1]}% for a share of the context window, or ${match[1]}k for tokens.` }
  }
  const tokens = Math.round(value * (unit === 'k' ? 1_000 : unit === 'm' ? 1_000_000 : 1))
  if (!(tokens >= MIN_TOKENS && tokens <= MAX_TOKENS)) return { kind: 'error', text: 'A token threshold must be from 1k to 10M tokens.' }
  return { kind: 'set', setting: { isOn: true, threshold: { kind: 'tokens', value: tokens } } }
}

export function autoStatusText(s: AutoSetting): string {
  const at = thresholdText(s.threshold)
  if (!s.isOn) {
    return `Automatic handoff is off. The quality warning shows at ${at}. Turn automatic handoff on with /autohandoff on, or set the threshold with /autohandoff 50% or /autohandoff 200k.`
  }
  return `Automatic handoff is on at ${at}. When the prompt cache is 5 minutes from going cold, you have been away and the conversation is at least that size, Cache Keeper starts a new session with a handoff brief. The quality warning uses the same threshold.`
}

// A stored setting as written by /autohandoff, or the default when it is missing or
// not one this version understands.
export function settingOf(stored: unknown): AutoSetting {
  if (typeof stored !== 'object' || stored === null) return DEFAULT_SETTING
  const { isOn, threshold } = stored as { isOn?: unknown; threshold?: { kind?: unknown; value?: unknown } }
  if (typeof isOn !== 'boolean' || typeof threshold !== 'object' || threshold === null) return DEFAULT_SETTING
  const { kind, value } = threshold
  if (typeof value !== 'number') return DEFAULT_SETTING
  if (kind === 'percent' && value >= 1 && value <= 100) return { isOn, threshold: { kind, value } }
  if (kind === 'tokens' && value >= MIN_TOKENS && value <= MAX_TOKENS) return { isOn, threshold: { kind, value } }
  return DEFAULT_SETTING
}

// Automatic handoff runs only for a big conversation whose person is away: no turn
// running, no brief being written, nothing typed in the prompt box.
export function autoHandoffReady(i: {
  setting: AutoSetting
  context?: ContextFigures
  hasTurn: boolean
  turnRunning: boolean
  handoffRunning: boolean
  draft: string
}): boolean {
  return (
    i.setting.isOn &&
    i.hasTurn &&
    !i.turnRunning &&
    !i.handoffRunning &&
    i.draft.trim() === '' &&
    isOverThreshold(i.setting.threshold, i.context)
  )
}
