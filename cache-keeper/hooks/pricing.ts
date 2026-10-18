import type { Ttl } from './cache-clock.ts'

// Base input prices in USD per million tokens, from
// https://platform.claude.com/docs/en/about-claude/pricing as of 2026-10-18.
// On every model a cache write costs 1.25x (5-minute) or 2x (1-hour) the base input
// price, and US-only inference (inference_geo "us") costs 1.1x.
type Family = {
  readonly key: string
  readonly input: number
  readonly fastInput?: number
  readonly longPrompt?: { readonly over: number; readonly input: number }
}

const FAMILIES: readonly Family[] = [
  { key: 'fable-5-1', input: 10 },
  { key: 'mythos-5-1', input: 10 },
  { key: 'opus-5-5', input: 4, fastInput: 8 },
  { key: 'sonnet-5-5', input: 2 },
  { key: 'haiku-5-5', input: 0.1, longPrompt: { over: 100_000, input: 0.5 } },
  { key: 'fable-5', input: 10 },
  { key: 'mythos-5', input: 10 },
  { key: 'opus-5', input: 5, fastInput: 10 },
  { key: 'opus-4-8', input: 5, fastInput: 10 },
  { key: 'opus-4-7', input: 5 },
  { key: 'opus-4-6', input: 5 },
  { key: 'opus-4-5', input: 5 },
  { key: 'opus-4-1', input: 15 },
  { key: 'opus-4', input: 15 },
  { key: 'sonnet-5', input: 2 },
  { key: 'sonnet-4-6', input: 3 },
  { key: 'sonnet-4-5', input: 3 },
  { key: 'sonnet-4', input: 3 },
  { key: 'haiku-4-5', input: 1 },
]

// Longest key first, so claude-opus-5-5 matches opus-5-5 before opus-5.
const LONGEST_FIRST = [...FAMILIES].sort((a, b) => b.key.length - a.key.length)

export type PriceInput = { model: string; tokens: number; ttl: Ttl; speed?: string; geo?: string }

// What re-writing `tokens` into the prompt cache costs, excluding the response.
export function recacheUsd(input: PriceInput): number | undefined {
  const id = input.model.toLowerCase()
  const family = LONGEST_FIRST.find((f) => id.includes(`claude-${f.key}`))
  if (family === undefined) return undefined
  const rate = baseInput(family, input) * (input.ttl === '1h' ? 2 : 1.25) * (input.geo === 'us' ? 1.1 : 1)
  return (input.tokens / 1_000_000) * rate
}

function baseInput(family: Family, input: PriceInput): number {
  if (input.speed === 'fast' && family.fastInput !== undefined) return family.fastInput
  if (family.longPrompt !== undefined && input.tokens > family.longPrompt.over) return family.longPrompt.input
  return family.input
}
