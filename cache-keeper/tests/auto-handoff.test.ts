import { expect, test } from 'claude-code/testing'
import { STORE_KEY } from '../hooks/threshold.ts'
import type { World } from './world.ts'
import { SESSION, ZERO_USAGE, measure, runStep, startTurn, world } from './world.ts'

// On a 6-minute window the 5-minute warning comes 1 minute after the last request.
const SIX_MINUTES = { options: { default_cache_minutes: 6 } }
const ON_AT_HALF = { isOn: true, threshold: { kind: 'percent', value: 50 } }
const toastScripts = (w: World) => w.scripts.filter((s) => s.includes('ToastNotificationManager'))
const coldWarnings = (w: World) => toastScripts(w).filter((s) => s.includes('Prompt cache goes cold in 5 min.'))
const autoNotices = (w: World) => toastScripts(w).filter((s) => s.includes('started a new session with a handoff brief'))

test('off by default: the warning only warns', SIX_MINUTES, async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 900_000)
  await w.clock.advance(61_000)
  await w.clock.settle()
  expect(coldWarnings(w)).toHaveLength(1)
  expect(w.calls).toEqual([])
})

test('on, big and idle: the warning runs New session with handoff and says so', SIX_MINUTES, async ($, on) => {
  const w = world(on)
  w.store[STORE_KEY] = ON_AT_HALF
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 520_000)
  await w.clock.advance(61_000)
  await w.clock.settle()
  expect(w.calls).toEqual(['fork', 'write', 'clear', 'fill'])
  expect(coldWarnings(w)).toHaveLength(0)
  expect(autoNotices(w)).toHaveLength(1)
  expect(autoNotices(w)[0]).toContain('waiting in the prompt box')
})

test('under the threshold, the warning only warns', SIX_MINUTES, async ($, on) => {
  const w = world(on)
  w.store[STORE_KEY] = ON_AT_HALF
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 300_000)
  await w.clock.advance(61_000)
  await w.clock.settle()
  expect(coldWarnings(w)).toHaveLength(1)
  expect(w.calls).toEqual([])
})

test('a running turn or a draft in the prompt box means you are not away', SIX_MINUTES, async ($, on) => {
  const w = world(on)
  w.store[STORE_KEY] = ON_AT_HALF
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 520_000)
  await startTurn($)
  await w.clock.advance(61_000)
  await w.clock.settle()
  expect(w.calls, 'a turn is running').toEqual([])
  expect(coldWarnings(w)).toHaveLength(1)
})

test('a draft in the prompt box means you are not away', SIX_MINUTES, async ($, on) => {
  const w = world(on)
  w.store[STORE_KEY] = ON_AT_HALF
  w.draft = 'half a thought'
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 520_000)
  await w.clock.advance(61_000)
  await w.clock.settle()
  expect(w.calls).toEqual([])
  expect(coldWarnings(w)).toHaveLength(1)
})

test('coming back while the brief is written keeps the session and the brief', SIX_MINUTES, async ($, on) => {
  const w = world(on)
  w.store[STORE_KEY] = ON_AT_HALF
  w.forkDelayMs = 10_000
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 520_000)
  await w.clock.advance(61_000)
  await startTurn($)
  await w.clock.advance(10_000)
  await w.clock.settle()
  expect(w.calls).toEqual(['fork', 'write'])
  const kept = w.toasts.find((t) => t.startsWith('Automatic handoff saved a brief at C:\\Users\\Brian\\.claude\\cache-keeper\\handoffs\\'))
  expect(kept).toEndWith('.md but left this session as it was, because you came back.')
  expect(autoNotices(w)).toHaveLength(0)
})

test('typing while the brief is written also keeps the session', SIX_MINUTES, async ($, on) => {
  const w = world(on)
  w.store[STORE_KEY] = ON_AT_HALF
  w.forkDelayMs = 10_000
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 520_000)
  await w.clock.advance(61_000)
  w.draft = 'wait'
  await w.clock.advance(10_000)
  await w.clock.settle()
  expect(w.calls).toEqual(['fork', 'write'])
})

test('a failed brief falls back to the plain warning', SIX_MINUTES, async ($, on) => {
  const w = world(on)
  w.store[STORE_KEY] = ON_AT_HALF
  w.forkResult = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: ZERO_USAGE }
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 520_000)
  await w.clock.advance(61_000)
  await w.clock.settle()
  expect(w.calls).toEqual(['fork'])
  expect(w.toasts).toContain('New session with handoff stopped: the brief request failed (529).')
  expect(coldWarnings(w)).toHaveLength(1)
})
