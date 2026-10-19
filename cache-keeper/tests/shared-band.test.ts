import type { Plugin } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'
import { SESSION, mountBand, runStep, world } from './world.ts'

// Stand-ins for Assumption Tracker's strip, which shares the band above the prompt:
// one drawn beneath Cache Keeper that draws alone (as its 0.1.0 does), and one above
// it that keeps what is beneath. An inline plugin closes over nothing of the test file.
const TRACKER_BELOW: Plugin = {
  name: 'assumption-tracker',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      if (e.props.hasSurvey) return next(e)
      const { Box, Button, Text } = $.ui.resolve(e)
      return Box({
        children: [
          Text({ children: ['Claude made 3 assumptions.'] }),
          Button({ key: 'review', label: 'review', hotkey: '0', plain: true, onPress: async () => void (await $.ui.toast('review opened')) }),
        ],
      })
    })
  },
}

const TRACKER_ABOVE: Plugin = {
  name: 'assumption-tracker',
  tier: 'prepend',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const below = await next(e)
      if (e.props.hasSurvey) return below
      const { Box, Button, Text } = $.ui.resolve(e)
      const mine = Box({
        children: [
          Text({ children: ['Claude made 3 assumptions.'] }),
          Button({ key: 'review', label: 'review', hotkey: '0', plain: true, onPress: async () => void (await $.ui.toast('review opened')) }),
        ],
      })
      return below.type === 'engine' ? mine : Box({ flexDirection: 'column', children: [mine, below] })
    })
  },
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: over another mod's strip, both show and both work`, { plugins: [TRACKER_BELOW] }, async ($, on) => {
    const w = world(on)
    await $.session.start(SESSION)
    await runStep($)
    const ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Text', text: 'cache' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Claude made 3 assumptions.' })).toBeDefined()
    await ui.press({ plugin: 'assumption-tracker', key: 'review' })
    expect(w.toasts).toEqual(['review opened'])
    await ui.press({ key: 'handoff' })
    expect(w.calls).toEqual(['fork', 'write', 'clear', 'fill'])
  })

  test(`${surface}: under a mod that keeps what is beneath, both show`, { plugins: [TRACKER_ABOVE] }, async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await runStep($)
    const ui = await mountBand($, surface)
    expect(await ui.find({ type: 'Text', text: 'cache' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Claude made 3 assumptions.' })).toBeDefined()
  })
}

test('a survey still takes the band from both', { plugins: [TRACKER_BELOW] }, async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => (e.props.hasSurvey ? { type: 'Text', props: {}, children: ['survey'] } : next(e)))
  world(on)
  await $.session.start(SESSION)
  const ui = await mountBand($, 'terminal', { hasSurvey: true, isWorking: false, maxRows: 8, bodyColumns: 115, scroll: { offset: 0, bodyRows: 8 }, view: {} })
  expect(await ui.find({ type: 'Text', text: 'survey' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'cache' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Claude made 3 assumptions.' })).toBeUndefined()
})
