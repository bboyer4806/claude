import { expect, test } from 'claude-code/testing'
import { STORE_KEY } from '../hooks/threshold.ts'
import { SESSION, measure, mountBand, runCommand, runStep, world } from './world.ts'

test('the session adds /handoff and /autohandoff', async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  expect(w.commands).toEqual(['handoff', 'autohandoff'])
})

test('/autohandoff alone shows the setting, off at 50% to begin with', async ($, on) => {
  world(on)
  await $.session.start(SESSION)
  expect((await runCommand($, 'autohandoff')).text).toStartWith('Automatic handoff is off. The quality warning shows at 50% of the context window.')
})

test('/autohandoff 30% saves the threshold, turns it on and moves the quality warning', async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  await measure($, 400_000)
  expect(await (await mountBand($)).find({ type: 'Text', text: 'quality may slip' })).toBeUndefined()
  expect((await runCommand($, 'autohandoff', '30%')).text).toStartWith('Automatic handoff is on at 30% of the context window.')
  expect(w.store[STORE_KEY]).toEqual({ isOn: true, threshold: { kind: 'percent', value: 30 } })
  expect(await (await mountBand($)).find({ type: 'Text', text: 'quality may slip' })).toBeDefined()
})

test('/autohandoff off keeps the threshold', async ($, on) => {
  const w = world(on)
  w.store[STORE_KEY] = { isOn: true, threshold: { kind: 'tokens', value: 200_000 } }
  await $.session.start(SESSION)
  expect((await runCommand($, 'autohandoff', 'off')).text).toStartWith('Automatic handoff is off. The quality warning shows at 200k tokens.')
  expect(w.store[STORE_KEY]).toEqual({ isOn: false, threshold: { kind: 'tokens', value: 200_000 } })
})

test('a refused threshold changes nothing', async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  expect((await runCommand($, 'autohandoff', '50')).text).toBe('"50" has no unit. Type 50% for a share of the context window, or 50k for tokens.')
  expect(w.store[STORE_KEY]).toBeUndefined()
})

test('a setting saved by another session is read back', async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  w.store[STORE_KEY] = { isOn: true, threshold: { kind: 'tokens', value: 200_000 } }
  expect((await runCommand($, 'autohandoff')).text).toStartWith('Automatic handoff is on at 200k tokens.')
})

test('/handoff runs New session with handoff once the command is done', async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  await runStep($)
  expect((await runCommand($, 'handoff')).text).toBe('Writing a handoff brief. Cache Keeper then starts a new session with the brief in the prompt box.')
  await w.clock.settle()
  expect(w.calls).toEqual(['fork', 'write', 'clear', 'fill'])
})

test('/handoff while a brief is being written says so', async ($, on) => {
  const w = world(on)
  w.forkDelayMs = 5_000
  await $.session.start(SESSION)
  await runStep($)
  await runCommand($, 'handoff')
  await w.clock.settle()
  expect((await runCommand($, 'handoff')).text).toBe('A handoff brief is already being written.')
  await w.clock.advance(5_000)
  expect(w.calls.filter((c) => c === 'fork')).toHaveLength(1)
})
