import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

import { fixPrompt, parseAssumptions } from '../hooks/prompts'

const PLUGIN = 'assumption-tracker'
const PANE = 'assumptions'
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REPLY = '<assumptions>["Used Python 3.12", "Saved the output as CSV", "Skipped rows with no date"]</assumptions>'

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
const PANE_PROPS = {
  title: 'Assumptions',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

/** The world beneath the plugin: a fork that answers REPLY, and records of what it opened and sent. */
function world(on: On, reply = REPLY) {
  const clock = mock.clock(on)
  const sent: string[] = []
  const opened: string[] = []

  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('model.fork', () => ({ value: { isAnswered: true as const, text: reply, usage: ZERO } }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.focus', () => ({}))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('prompt.submit', ($, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })

  return { clock, sent, opened }
}

test('parses the fork reply and drops junk', () => {
  expect(parseAssumptions('noise <assumptions>["A", " ", "A", 3, "B"]</assumptions>')?.map(a => a.text)).toEqual(['A', 'B'])
  expect(parseAssumptions('<assumptions>[]</assumptions>')).toEqual([])
  expect(parseAssumptions('I made no assumptions.')).toBeNull()
  expect(parseAssumptions('<assumptions>not json</assumptions>')).toBeNull()
})

test('the fix prompt names the wrong items with notes and keeps the right ones', () => {
  const text = fixPrompt([
    { id: 'a1', text: 'Used Python 3.12', verdict: 'wrong', note: 'Use 3.11' },
    { id: 'a2', text: 'Saved the output as CSV', verdict: 'right', note: '' },
    { id: 'a3', text: 'Skipped rows with no date', verdict: 'wrong', note: '' },
    { id: 'a4', text: 'Unreviewed thing', verdict: null, note: '' },
  ])
  expect(text).toContain('1. Used Python 3.12\n   My note: Use 3.11')
  expect(text).toContain('2. Skipped rows with no date\n   (No note:')
  expect(text).toContain('Right, keep these exactly as they are:\n- Saved the output as CSV')
  expect(text).not.toContain('Unreviewed thing')
})

for (const surface of ['terminal', 'desktop'] as const satisfies readonly RenderSurface[]) {
  test(`${surface}: a finished task shows the strip and a review sends only the wrong ones`, async ($, on) => {
    const w = world(on)

    await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    await w.clock.settle()

    const band = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ type: 'Text', text: 'Claude made 3 assumptions.' })).toBeDefined()
    expect((await band.find({ key: 'review' }))?.props.hotkey).toBe('0')

    await band.press({ key: 'review' })
    expect(w.opened).toEqual([PANE])

    const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })
    expect(await pane.findAll({ type: 'Button', text: 'Right' })).toHaveLength(3)

    // The kit does not route a plugin's $.ui.focus to the test's hooks, so the
    // focus moves after a mark are checked in a live session, not here.
    await pane.press({ key: 'wrong:a1' })
    await pane.input({ key: 'note:a1', text: 'Use Python 3.11', kind: 'change' })
    await pane.press({ key: 'right:a2' })
    expect((await pane.find({ key: 'done' }))?.props.label).toBe('Send 1 fix to Claude')

    await pane.press({ key: 'done' })
    expect(w.sent).toHaveLength(1)
    expect(w.sent[0]).toContain('1. Used Python 3.12\n   My note: Use Python 3.11')
    expect(w.sent[0]).toContain('- Saved the output as CSV')
    expect(w.sent[0]).not.toContain('Skipped rows with no date')

    await band.redraw()
    expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  })
}

test('the fix prompt is sent once, however often the review is closed', async ($, on) => {
  const w = world(on)
  await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.settle()

  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  await pane.press({ key: 'wrong:a3' })
  await pane.press({ key: 'done' })
  expect((await pane.find({ key: 'done' }))?.props.label).toBe('Close')
  await pane.press({ key: 'done' })

  expect(w.sent).toHaveLength(1)
  expect(w.sent[0]).toContain('1. Skipped rows with no date')
})

test('pressing a verdict twice clears it', async ($, on) => {
  const w = world(on)
  await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.settle()

  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  await pane.press({ key: 'wrong:a1' })
  expect((await pane.find({ key: 'wrong:a1' }))?.props.variant).toBe('primary')
  await pane.press({ key: 'wrong:a1' })
  expect((await pane.find({ key: 'wrong:a1' }))?.props.variant).toBeUndefined()
  expect((await pane.find({ key: 'done' }))?.props.label).toBe('Done')
})

test('a review with nothing marked wrong sends nothing', async ($, on) => {
  const w = world(on)
  await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.settle()

  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  await pane.press({ key: 'right:a1' })
  expect((await pane.find({ key: 'done' }))?.props.label).toBe('Done')
  await pane.press({ key: 'done' })

  expect(w.sent).toHaveLength(0)
})

test('no strip for a subagent, an interrupted turn, or a task with no assumptions', async ($, on) => {
  const w = world(on, '<assumptions>[]</assumptions>')

  await $.turn.complete({ answer: '', durationMs: 10, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'agent-1' })
  await $.turn.complete({ answer: '', durationMs: 10, isAborted: true, turnId: 'stop', reason: 'aborted' })
  await $.turn.complete({ answer: 'Done.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.settle()

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
})
