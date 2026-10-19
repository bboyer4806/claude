import type { Engine } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'
import { fillRefusedText, handoffDraft, handoffFileName, handoffPath } from '../hooks/handoff.ts'
import { BAND_PROPS, SESSION, T0, ZERO_USAGE, mountBand, runStep, world } from './world.ts'

const PATH = handoffPath('C:\\Users\\Brian', handoffFileName(T0, 'bucket-dash'))

async function startAndPress($: Engine): Promise<void> {
  await $.session.start(SESSION)
  await runStep($)
  const ui = await mountBand($)
  await ui.press({ key: 'handoff' })
}

test('the button appears after a main turn and hides while working', async ($, on) => {
  world(on)
  await $.session.start(SESSION)
  expect(await (await mountBand($)).find({ key: 'handoff' })).toBeUndefined()
  await runStep($)
  expect((await (await mountBand($)).find({ key: 'handoff' }))?.props.label).toBe('New session with handoff')
  const working = await mountBand($, 'terminal', { ...BAND_PROPS, isWorking: true })
  expect(await working.find({ key: 'handoff' })).toBeUndefined()
})

test('New session with handoff forks, saves, clears, then drafts the brief', async ($, on) => {
  const w = world(on)
  await startAndPress($)
  expect(w.calls).toEqual(['fork', 'write', 'clear', 'fill'])
  // The kit applies the host's path rules: on Linux a C:\ path gets the process cwd in front.
  expect(w.written[0]?.path).toEndWith(PATH)
  expect(w.written[0]?.text).toStartWith('# Handoff brief: bucket-dash')
  expect(w.filled).toEqual([handoffDraft(PATH, '## Goal\nShip it.')])
  expect(w.toasts).toEqual([])
})

test('a failed brief stops before saving or clearing', async ($, on) => {
  const w = world(on)
  w.forkResult = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: ZERO_USAGE }
  await startAndPress($)
  expect(w.calls).toEqual(['fork'])
  expect(w.toasts).toEqual(['New session with handoff stopped: the brief request failed (529).'])
})

test('a refused save never clears', async ($, on) => {
  const w = world(on, { writeFails: true })
  await startAndPress($)
  expect(w.calls).toEqual(['fork', 'write'])
  expect(w.toasts[0]).toStartWith('New session with handoff stopped:')
})

test('an unset USERPROFILE stops before saving', async ($, on) => {
  const w = world(on, { userProfile: null })
  await startAndPress($)
  expect(w.calls).toEqual(['fork'])
  expect(w.toasts).toEqual(['New session with handoff stopped: USERPROFILE is not set.'])
})

test('a failed clear names the saved brief', async ($, on) => {
  const w = world(on, { clearFails: true })
  await startAndPress($)
  expect(w.toasts[0]).toEndWith(`The brief is saved at ${PATH}.`)
})

// The engine strips a refusal cause a hook writes itself, and the kit's stubs are
// hooks, so only the cause-less refusal can reach the mod here.
test('a refused fill names the saved brief', async ($, on) => {
  const w = world(on)
  w.fillResult = { isFilled: false }
  await startAndPress($)
  expect(w.toasts).toEqual([fillRefusedText(PATH)])
})

test('the band shows progress and takes no second press while writing', async ($, on) => {
  const w = world(on)
  w.forkDelayMs = 5_000
  await $.session.start(SESSION)
  await runStep($)
  const ui = await mountBand($)
  const pressing = ui.press({ key: 'handoff' })
  await w.clock.settle()
  expect(await ui.find({ key: 'handoff' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'writing handoff brief...' })).toBeDefined()
  await w.clock.advance(5_000)
  await pressing
  expect(w.calls.filter((c) => c === 'fork')).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: 'writing handoff brief...' })).toBeUndefined()
})
