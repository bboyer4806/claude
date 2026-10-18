import { expect, test } from 'claude-code/testing'
import type { CacheState } from '../hooks/cache-clock.ts'
import type { BandElements } from '../hooks/band.ts'
import { bandModelOf, bandTree, segmentsOf, warningMessage } from '../hooks/band.ts'

const T0 = 1_000_000
const NOW = T0 + 768_000
const cache: CacheState = { hasTurn: true, anchorAt: T0, ttl: '1h', model: 'claude-opus-5-5', basisTokens: 182_400 }
const usage = {
  context: { tokens: 182_400, percent: 18 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 34.2, resetsAt: new Date(NOW + 7_800_000).toISOString() },
    { kind: 'seven_day', percentUsed: 61, resetsAt: new Date(NOW + 273_600_000).toISOString() },
  ],
  cost: { usd: 12.84 },
}
const IDLE = { isWorking: false, handoffRunning: false }
const segs = (c: CacheState, now: number) => segmentsOf(bandModelOf({ cache: c, usage, now, defaultMinutes: 60, ...IDLE }))

test('a warm cache reads like the approved mockup', () => {
  expect(segs(cache, NOW)).toEqual([
    { label: 'cache', value: '47:12', color: 'success', note: '1h detected' },
    { label: 'ctx', value: '182.4k 18%' },
    { label: '5h', value: '34% ↻2h10m' },
    { label: 'wk', value: '61% ↻3d4h' },
    { label: 'session', value: '$12.84' },
    { label: 'if cold', value: '$1.46' },
  ])
})

test('the last 5 minutes use the warning color', () => {
  expect(segs(cache, T0 + 3_300_000)[0]).toEqual({ label: 'cache', value: '5:00', color: 'warning', note: '1h detected' })
})

test('a cold cache shows what the next message costs', () => {
  const s = segs(cache, T0 + 3_600_000)
  expect(s[0]).toEqual({ label: 'cache', value: 'cold', color: 'error' })
  expect(s[5]).toEqual({ label: 'next msg', value: '$1.46' })
})

test('figures not reported yet show --', () => {
  expect(segmentsOf(bandModelOf({ cache: { hasTurn: false }, now: T0, defaultMinutes: 45, ...IDLE }))).toEqual([
    { label: 'cache', value: '--:--', note: '45m set' },
    { label: 'ctx', value: '--' },
    { label: '5h', value: '--' },
    { label: 'wk', value: '--' },
    { label: 'session', value: '--' },
    { label: 'if cold', value: '--' },
  ])
})

test('an unknown model has no price', () => {
  expect(segs({ ...cache, model: 'gpt-6' }, NOW)[5]).toEqual({ label: 'if cold', value: 'no price for gpt-6' })
})

test('the handoff button is ready after a turn when idle, hidden while working or before a turn, writing during a handoff', () => {
  const button = (c: CacheState, flags: { isWorking: boolean; handoffRunning: boolean }) =>
    bandModelOf({ cache: c, usage, now: NOW, defaultMinutes: 60, ...flags }).button
  expect(button(cache, IDLE)).toBe('ready')
  expect(button(cache, { isWorking: true, handoffRunning: false })).toBe('hidden')
  expect(button({ hasTurn: false }, IDLE)).toBe('hidden')
  expect(button(cache, { isWorking: false, handoffRunning: true })).toBe('writing')
})

test('warningMessage names the project and the cost when it is known', () => {
  expect(warningMessage('bucket-dash', { kind: 'usd', usd: 1.4592 })).toEqual({
    title: 'Cache Keeper: bucket-dash',
    body: 'Prompt cache goes cold in 5 min. Re-caching after that costs $1.46. Send a message to keep it warm, or use Handoff & Clear.',
  })
  expect(warningMessage('x', { kind: 'unpriced', model: 'gpt-6' }).body)
    .toBe('Prompt cache goes cold in 5 min. Send a message to keep it warm, or use Handoff & Clear.')
})

// Stand-in element constructors that keep their props, so the tree's shape can be read.
type Fake = { type: string; props: { children?: unknown[]; [prop: string]: unknown } }
const fake = (type: string) => (props: Fake['props']): Fake => ({ type, props })
const FAKE_ELEMENTS = { Box: fake('Box'), Text: fake('Text'), Button: fake('Button') } as unknown as BandElements
const noHandoff = async () => {}
const rowsOf = (flags: { isWorking: boolean; handoffRunning: boolean }) => {
  const tree = bandTree(FAKE_ELEMENTS, bandModelOf({ cache, usage, now: NOW, defaultMinutes: 60, ...flags }), noHandoff) as unknown as Fake
  return { tree, rows: (tree.props.children ?? []) as Fake[] }
}

test('bandTree draws one row per segment, coloring only the value', () => {
  const { tree, rows } = rowsOf(IDLE)
  const cells = (i: number) => ((rows[i]?.props.children ?? []) as Fake[]).map((cell) => cell.props)
  expect(tree.props.flexWrap).toBe('wrap')
  expect(cells(0)).toEqual([
    { dimColor: true, children: ['cache'] },
    { color: 'success', children: ['47:12'] },
    { dimColor: true, children: ['1h detected'] },
  ])
  expect(cells(1)).toEqual([{ dimColor: true, children: ['ctx'] }, { children: ['182.4k 18%'] }])
})

test('bandTree ends with the Handoff & Clear button when ready, or a note while writing', () => {
  const ready = rowsOf(IDLE).rows
  expect(ready).toHaveLength(7)
  expect(ready[6]?.type).toBe('Button')
  expect(ready[6]?.props).toMatchObject({ key: 'handoff', label: 'Handoff & Clear', hotkey: 'h', plain: true })
  const writing = rowsOf({ isWorking: false, handoffRunning: true }).rows
  expect(writing[6]?.props).toEqual({ dimColor: true, children: ['writing handoff brief...'] })
  expect(rowsOf({ isWorking: true, handoffRunning: false }).rows).toHaveLength(6)
})
