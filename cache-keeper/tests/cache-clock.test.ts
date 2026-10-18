import { expect, test } from 'claude-code/testing'
import { INITIAL_STATE, cacheView, defaultMinutesOf, onModelSwitch, onReset, onResume, onStep, onTranscript, onWarned, pricingTtlOf, shouldWarn } from '../hooks/cache-clock.ts'

const T0 = 1_000_000
const USAGE = { input_tokens: 2, output_tokens: 3_651, cache_read_input_tokens: 425_512, cache_creation_input_tokens: 2_893, model: 'claude-opus-5-5' }
const stepped = onStep(INITIAL_STATE, T0, USAGE)
const hour = onTranscript(stepped, { model: 'claude-opus-5-5', ttl: '1h', speed: 'standard', geo: 'global' })

// Claude Code's own check on the setting is the range alone, so 7.5 can be saved.
test('defaultMinutesOf accepts any number of minutes from 1 to 60', () => {
  expect(defaultMinutesOf({ default_cache_minutes: 60 })).toBe(60)
  expect(defaultMinutesOf({ default_cache_minutes: 1 })).toBe(1)
  expect(defaultMinutesOf({ default_cache_minutes: 7.5 })).toBe(7.5)
  for (const bad of [0, 61, Number.NaN, '60', undefined]) {
    expect(() => defaultMinutesOf({ default_cache_minutes: bad })).toThrow('default_cache_minutes')
  }
})

test('a main step anchors the clock and records what the next request re-sends', () => {
  expect(stepped).toEqual({ hasTurn: true, anchorAt: T0, model: 'claude-opus-5-5', basisTokens: 432_058 })
  expect(cacheView(stepped, T0 + 768_000, 60)).toEqual({ kind: 'warm', ttlLabel: '60m set', remainingMs: 2_832_000, isWarning: false })
})

test('a detected window replaces the setting; the warning starts 5 minutes before cold', () => {
  expect(cacheView(hour, T0 + 3_299_999, 60)).toEqual({ kind: 'warm', ttlLabel: '1h detected', remainingMs: 300_001, isWarning: false })
  expect(cacheView(hour, T0 + 3_300_000, 60)).toEqual({ kind: 'warm', ttlLabel: '1h detected', remainingMs: 300_000, isWarning: true })
  expect(cacheView(hour, T0 + 3_600_000, 60)).toEqual({ kind: 'cold', ttlLabel: '1h detected' })
})

test('a 5-minute window never warns', () => {
  const s = onTranscript(stepped, { model: 'claude-opus-5-5', ttl: '5m' })
  const view = cacheView(s, T0 + 1_000, 60)
  expect(view).toEqual({ kind: 'warm', ttlLabel: '5m detected', remainingMs: 299_000, isWarning: false })
  expect(shouldWarn(s, view)).toBe(false)
})

test('a transcript row without cache writes keeps the earlier window', () => {
  expect(onTranscript(hour, { model: 'claude-opus-5-5' }).ttl).toBe('1h')
})

test('warns once per anchor, and never once cold (a computer waking from sleep)', () => {
  const warning = cacheView(hour, T0 + 3_300_000, 60)
  expect(shouldWarn(hour, warning)).toBe(true)
  expect(shouldWarn(onWarned(hour), warning)).toBe(false)
  expect(shouldWarn(hour, cacheView(hour, T0 + 3_700_000, 60))).toBe(false)
})

test('clear and compact leave no cached conversation', () => {
  const s = onReset(hour)
  expect(cacheView(s, T0, 60)).toEqual({ kind: 'none', ttlLabel: '1h detected' })
  expect(s.hasTurn).toBe(false)
})

test('resume backdates the anchor by the time since the last reply', () => {
  const s = onResume(INITIAL_STATE, 10_000_000, { seconds_since_last_response: 600, context_tokens: 182_400, model: 'claude-opus-5-5' })
  expect(s).toEqual({ hasTurn: false, anchorAt: 9_400_000, basisTokens: 182_400, model: 'claude-opus-5-5' })
  const gapUnknown = onResume(INITIAL_STATE, 10_000_000, { context_tokens: 182_400 })
  expect(cacheView(gapUnknown, 10_000_000, 60).kind).toBe('cold')
})

test('a model switch starts the new model cold with Claude Code\'s own window', () => {
  const s = onModelSwitch(stepped, { to_model: 'claude-sonnet-5-5', cache_ttl: '1h', context_tokens: 182_400 })
  expect(s).toMatchObject({ model: 'claude-sonnet-5-5', ttl: '1h', basisTokens: 182_400, hasTurn: true })
  expect(s.anchorAt).toBeUndefined()
  expect(cacheView(s, T0, 60).kind).toBe('cold')
})

test('pricing uses the detected window, else 1h when the setting is over 5 minutes', () => {
  expect(pricingTtlOf(INITIAL_STATE, 60)).toBe('1h')
  expect(pricingTtlOf(INITIAL_STATE, 5)).toBe('5m')
  expect(pricingTtlOf({ hasTurn: false, ttl: '5m' }, 60)).toBe('5m')
})
