import { expect, test } from 'claude-code/testing'
import { recacheUsd } from '../hooks/pricing.ts'

// Hundredths of a cent, so float noise can't fail a comparison
const units = (model: string, tokens: number, ttl: '5m' | '1h', extra: { speed?: string; geo?: string } = {}) => {
  const usd = recacheUsd({ model, tokens, ttl, ...extra })
  return usd === undefined ? undefined : Math.round(usd * 10_000)
}

test('Opus 5.5 at 182,400 tokens', () => {
  expect(units('claude-opus-5-5', 182_400, '1h')).toBe(14_592)
  expect(units('claude-opus-5-5', 182_400, '5m')).toBe(9_120)
  expect(units('claude-opus-5-5', 182_400, '1h', { speed: 'fast' })).toBe(29_184)
  expect(units('claude-opus-5-5', 182_400, '1h', { geo: 'us' })).toBe(16_051)
})

test('Haiku 5.5 uses its long-prompt price over 100,000 tokens', () => {
  expect(units('claude-haiku-5-5', 90_000, '1h')).toBe(180)
  expect(units('claude-haiku-5-5', 120_000, '1h')).toBe(1_200)
})

test('model ids match by family, with suffixes', () => {
  expect(units('claude-sonnet-5-5[1m]', 100_000, '1h')).toBe(4_000)
  expect(units('claude-opus-5-20260601', 100_000, '1h')).toBe(10_000)
  expect(units('claude-opus-4-1-20250805', 100_000, '1h')).toBe(30_000)
  expect(units('claude-fable-5-1', 100_000, '5m')).toBe(12_500)
})

test('an unknown model has no price', () => {
  expect(recacheUsd({ model: 'gpt-6', tokens: 100_000, ttl: '1h' })).toBeUndefined()
})
