import { expect, test } from 'claude-code/testing'
import { assistantRow } from './fixtures.ts'
import { BAND_PROPS, SESSION, mountBand, runStep, world } from './world.ts'

const RESUME = { source: 'resume', model: 'claude-opus-5-5', context_tokens: 182_400, transcript_path: 'C:\\t.jsonl' } as const
const STOP = { stop_hook_active: false, transcript_path: 'C:\\t.jsonl' }
const toastScripts = (scripts: string[]) => scripts.filter((s) => s.includes('ToastNotificationManager'))

test('a main step starts the countdown, on terminal and desktop', async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  await runStep($)
  const drawings = [await mountBand($, 'terminal'), await mountBand($, 'desktop')]
  for (const ui of drawings) {
    expect(await ui.find({ type: 'Text', text: '60:00' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '60m set' })).toBeDefined()
  }
  await w.clock.advance(2_000)
  for (const ui of drawings) {
    expect(await ui.find({ type: 'Text', text: '59:58' })).toBeDefined()
  }
})

test('subagent steps leave the clock alone', async ($, on) => {
  world(on)
  await $.session.start(SESSION)
  await runStep($, 'agent-1')
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: '--:--' })).toBeDefined()
})

test('Stop reads the cache window from the transcript tail', async ($, on) => {
  const w = world(on)
  w.tail.output = assistantRow({ ttl5m: 700 })
  await $.session.start(SESSION)
  await $.classic.Stop(STOP)
  await w.clock.settle()
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: '5m detected' })).toBeDefined()
  expect(w.scripts[0]).toContain("-LiteralPath 'C:\\t.jsonl'")
})

test('a failed tail read toasts once per session', async ($, on) => {
  const w = world(on)
  w.tail = { output: '', exitCode: 1, stderr: 'boom' }
  await $.session.start(SESSION)
  await $.classic.Stop(STOP)
  await $.classic.Stop(STOP)
  await w.clock.settle()
  expect(w.toasts).toEqual(['Cache Keeper could not read the cache window: boom'])
})

test('warns once, 5 minutes before cold', async ($, on) => {
  const w = world(on)
  await $.session.start(SESSION)
  await $.classic.SessionStart({ ...RESUME, seconds_since_last_response: 3_290 })
  await w.clock.advance(10_000)
  await w.clock.advance(60_000)
  const sent = toastScripts(w.scripts)
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('Cache Keeper: bucket-dash')
  expect(sent[0]).toContain('Re-caching after that costs $1.46')
})

test('a 5-minute window never warns', async ($, on) => {
  const w = world(on)
  w.tail.output = assistantRow({ ttl5m: 700 })
  await $.session.start(SESSION)
  await $.classic.SessionStart({ ...RESUME, seconds_since_last_response: 5 })
  await w.clock.settle()
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: '5m detected' })).toBeDefined()
  await w.clock.advance(10_000)
  expect(toastScripts(w.scripts)).toHaveLength(0)
})

test('a failed Windows toast shows an in-app toast', async ($, on) => {
  const w = world(on)
  w.toast = { exitCode: 1, stderr: 'no WinRT' }
  await $.session.start(SESSION)
  await $.classic.SessionStart({ ...RESUME, seconds_since_last_response: 3_290 })
  await w.clock.advance(10_000)
  await w.clock.settle()
  expect(w.toasts).toEqual(['Cache Keeper could not show a Windows notification: no WinRT'])
})

test("a model switch shows cold with the new model's price", async ($, on) => {
  world(on)
  await $.session.start(SESSION)
  await runStep($)
  await $.classic.PostModelSwitch({
    from_model: 'claude-opus-5-5',
    to_model: 'claude-sonnet-5-5',
    requested_model: 'sonnet',
    source: 'command',
    context_tokens: 182_400,
    prompt_cache_warm: true,
    cache_ttl: '1h',
    estimated_cache_write_usd: 0.73,
    pricing: 'catalog',
  })
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: /^cold$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'next msg' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$0.73' })).toBeDefined()
})

test('clear resets to --:--', async ($, on) => {
  world(on)
  await $.session.start(SESSION)
  await runStep($)
  await $.classic.SessionStart({ source: 'clear' })
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: '--:--' })).toBeDefined()
})

test('usage figures follow session.measure', async ($, on) => {
  world(on)
  await $.session.start(SESSION)
  await $.session.measure({
    context: { tokens: 50_000, window: 1_000_000, percent: 5 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 12 }],
    cost: { usd: 3.2 },
    changed: ['cost'],
  })
  const ui = await mountBand($)
  expect(await ui.find({ type: 'Text', text: '50k 5%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '12%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$3.20' })).toBeDefined()
})

test('the band yields to a survey', async ($, on) => {
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['survey'] }))
  world(on)
  await $.session.start(SESSION)
  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: '--:--' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'survey' })).toBeUndefined()
  const survey = await mountBand($, 'terminal', { ...BAND_PROPS, hasSurvey: true })
  expect(await survey.find({ type: 'Text', text: 'survey' })).toBeDefined()
  expect(await survey.find({ type: 'Text', text: '--:--' })).toBeUndefined()
})
