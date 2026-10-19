import { expect, test } from 'claude-code/testing'
import type { AutoSetting } from '../hooks/threshold.ts'
import { DEFAULT_SETTING, autoHandoffReady, autoStatusText, isOverThreshold, parseAutoArgs, settingOf, thresholdText } from '../hooks/threshold.ts'

const ON_30: AutoSetting = { isOn: true, threshold: { kind: 'percent', value: 30 } }
const READY = { setting: ON_30, context: { tokens: 400_000, window: 1_000_000 }, hasTurn: true, turnRunning: false, handoffRunning: false, draft: '' }

test('the default is off, at 50% of the context window', () => {
  expect(DEFAULT_SETTING).toEqual({ isOn: false, threshold: { kind: 'percent', value: 50 } })
})

test('a percentage compares tokens to the window, not the rounded percent', () => {
  const half = { kind: 'percent', value: 50 } as const
  expect(isOverThreshold(half, { tokens: 499_999, window: 1_000_000, percent: 50 })).toBe(false)
  expect(isOverThreshold(half, { tokens: 500_000, window: 1_000_000, percent: 50 })).toBe(true)
  expect(isOverThreshold(half, { percent: 51 })).toBe(true)
  expect(isOverThreshold(half, { window: 1_000_000 })).toBe(false)
  expect(isOverThreshold(half, undefined)).toBe(false)
})

test('a token count compares tokens alone', () => {
  const t = { kind: 'tokens', value: 200_000 } as const
  expect(isOverThreshold(t, { tokens: 199_999, window: 1_000_000 })).toBe(false)
  expect(isOverThreshold(t, { tokens: 200_000 })).toBe(true)
  expect(isOverThreshold(t, { percent: 90 })).toBe(false)
})

test('thresholdText names the unit', () => {
  expect(thresholdText({ kind: 'percent', value: 50 })).toBe('50% of the context window')
  expect(thresholdText({ kind: 'tokens', value: 200_000 })).toBe('200k tokens')
  expect(thresholdText({ kind: 'tokens', value: 1_500_000 })).toBe('1.5M tokens')
})

test('/autohandoff with nothing after it shows the setting', () => {
  expect(parseAutoArgs('', DEFAULT_SETTING)).toEqual({ kind: 'show' })
  expect(parseAutoArgs('   ', DEFAULT_SETTING)).toEqual({ kind: 'show' })
})

test('on and off keep the threshold', () => {
  expect(parseAutoArgs('on', DEFAULT_SETTING)).toEqual({ kind: 'set', setting: { isOn: true, threshold: { kind: 'percent', value: 50 } } })
  expect(parseAutoArgs(' OFF ', ON_30)).toEqual({ kind: 'set', setting: { isOn: false, threshold: { kind: 'percent', value: 30 } } })
})

test('a threshold sets it and turns automatic handoff on', () => {
  const set = (args: string) => parseAutoArgs(args, DEFAULT_SETTING)
  expect(set('30%')).toEqual({ kind: 'set', setting: { isOn: true, threshold: { kind: 'percent', value: 30 } } })
  expect(set('62.5 %')).toEqual({ kind: 'set', setting: { isOn: true, threshold: { kind: 'percent', value: 62.5 } } })
  expect(set('200k')).toEqual({ kind: 'set', setting: { isOn: true, threshold: { kind: 'tokens', value: 200_000 } } })
  expect(set('1.5M')).toEqual({ kind: 'set', setting: { isOn: true, threshold: { kind: 'tokens', value: 1_500_000 } } })
  expect(set('250000')).toEqual({ kind: 'set', setting: { isOn: true, threshold: { kind: 'tokens', value: 250_000 } } })
})

test('an unclear or out-of-range threshold is refused with the forms that work', () => {
  const error = (args: string) => {
    const r = parseAutoArgs(args, DEFAULT_SETTING)
    return r.kind === 'error' ? r.text : `not refused: ${JSON.stringify(r)}`
  }
  expect(error('50')).toBe('"50" has no unit. Type 50% for a share of the context window, or 50k for tokens.')
  expect(error('0%')).toBe('A percentage threshold must be from 1% to 100%.')
  expect(error('150%')).toBe('A percentage threshold must be from 1% to 100%.')
  expect(error('0.5k')).toBe('A token threshold must be from 1k to 10M tokens.')
  expect(error('20m')).toBe('A token threshold must be from 1k to 10M tokens.')
  expect(error('soon')).toBe('Cache Keeper did not understand "soon". Use /autohandoff on, /autohandoff off, or a threshold such as 50% or 200k.')
})

test('the status says what the setting does', () => {
  expect(autoStatusText(ON_30)).toBe(
    'Automatic handoff is on at 30% of the context window. When the prompt cache is 5 minutes from going cold, you have been away and the conversation is at least that size, Cache Keeper starts a new session with a handoff brief. The quality warning uses the same threshold.',
  )
  expect(autoStatusText(DEFAULT_SETTING)).toBe(
    'Automatic handoff is off. The quality warning shows at 50% of the context window. Turn automatic handoff on with /autohandoff on, or set the threshold with /autohandoff 50% or /autohandoff 200k.',
  )
})

test('settingOf reads a stored setting and falls back to the default', () => {
  expect(settingOf(undefined)).toEqual(DEFAULT_SETTING)
  expect(settingOf({ isOn: true, threshold: { kind: 'tokens', value: 200_000 } })).toEqual({ isOn: true, threshold: { kind: 'tokens', value: 200_000 } })
  expect(settingOf({ isOn: 'yes', threshold: { kind: 'percent', value: 50 } })).toEqual(DEFAULT_SETTING)
  expect(settingOf({ isOn: true, threshold: { kind: 'percent', value: 500 } })).toEqual(DEFAULT_SETTING)
  expect(settingOf({ isOn: true, threshold: { kind: 'lines', value: 5 } })).toEqual(DEFAULT_SETTING)
})

test('automatic handoff needs the setting on, a big idle conversation and an empty prompt box', () => {
  expect(autoHandoffReady(READY)).toBe(true)
  expect(autoHandoffReady({ ...READY, setting: { ...ON_30, isOn: false } })).toBe(false)
  expect(autoHandoffReady({ ...READY, context: { tokens: 200_000, window: 1_000_000 } })).toBe(false)
  expect(autoHandoffReady({ ...READY, hasTurn: false })).toBe(false)
  expect(autoHandoffReady({ ...READY, turnRunning: true })).toBe(false)
  expect(autoHandoffReady({ ...READY, handoffRunning: true })).toBe(false)
  expect(autoHandoffReady({ ...READY, draft: 'half a thought' })).toBe(false)
  expect(autoHandoffReady({ ...READY, draft: ' \n ' })).toBe(true)
})
