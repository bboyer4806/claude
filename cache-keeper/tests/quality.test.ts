import { expect, test } from 'claude-code/testing'
import { SESSION, measure, mountBand, runStep, world } from './world.ts'

const QUALITY_TOAST = 'Context is 520k tokens (52%), past your 50% threshold. Answers may start to slip: consider New session with handoff or Fresh session, above the prompt.'

test('past the threshold, ctx turns yellow and says quality may slip, on terminal and desktop', async ($, on) => {
  world(on)
  await $.session.start(SESSION)
  await measure($, 480_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Text', text: '480k 48%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'quality may slip' })).toBeUndefined()
  }
  await measure($, 520_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountBand($, surface)
    expect((await ui.find({ type: 'Text', text: '520k 52%' }))?.props.color).toBe('warning')
    expect(await ui.find({ type: 'Text', text: 'quality may slip' })).toBeDefined()
  }
})

test('the quality toast shows once per crossing', async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  await measure($, 520_000)
  await measure($, 560_000)
  expect(w.toasts).toEqual([QUALITY_TOAST])
  await measure($, 20_000) // a /compact or /clear brings it back under
  await measure($, 520_000)
  expect(w.toasts).toEqual([QUALITY_TOAST, QUALITY_TOAST])
})

test('the handoff button reads New session with handoff', async ($, on) => {
  world(on)
  await $.session.start(SESSION)
  await runStep($)
  const button = await (await mountBand($)).find({ key: 'handoff' })
  expect(button?.props).toMatchObject({ label: 'New session with handoff', hotkey: 'h' })
})

test('Fresh session shows only past the threshold, after a reply', async ($, on) => {
  world(on)
  await $.session.start(SESSION)
  await measure($, 520_000)
  expect(await (await mountBand($)).find({ key: 'fresh' }), 'no reply yet').toBeUndefined()
  await runStep($)
  await measure($, 300_000)
  expect(await (await mountBand($)).find({ key: 'fresh' }), 'under the threshold').toBeUndefined()
  await measure($, 520_000)
  expect((await (await mountBand($)).find({ key: 'fresh' }))?.props).toMatchObject({ label: 'Fresh session', hotkey: 'f' })
})

test('Fresh session clears on the second press, without a brief', async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 520_000)
  const ui = await mountBand($)
  await ui.press({ key: 'fresh' })
  expect(w.calls).toEqual([])
  expect((await ui.find({ key: 'fresh' }))?.props.label).toBe('Confirm fresh session')
  await ui.press({ key: 'fresh' })
  expect(w.calls).toEqual(['clear'])
})

test('an unconfirmed Fresh session lapses after 5 seconds', async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 520_000)
  const ui = await mountBand($)
  await ui.press({ key: 'fresh' })
  await w.clock.advance(5_000)
  expect((await ui.find({ key: 'fresh' }))?.props.label).toBe('Fresh session')
  await ui.press({ key: 'fresh' })
  expect(w.calls).toEqual([])
  expect((await ui.find({ key: 'fresh' }))?.props.label).toBe('Confirm fresh session')
})

test('a failed fresh session says so', async ($, on) => {
  const w = world(on, { clearFails: true })
  await $.session.start(SESSION)
  await runStep($)
  await measure($, 520_000)
  w.toasts.length = 0
  const ui = await mountBand($)
  await ui.press({ key: 'fresh' })
  await ui.press({ key: 'fresh' })
  // The kit turns a stub's throw into its own error, so only the prefix is the mod's.
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toStartWith('Fresh session stopped:')
})
