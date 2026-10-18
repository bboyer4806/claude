// The world beneath the mod in kit tests: every answer Claude Code would give,
// a clock the test moves, and what the mod asked for, recorded.

import type { On, ProcessRunResult, TurnUsage } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'
import { mock } from 'claude-code/testing'
import { decodeCommand } from './fixtures.ts'

export const T0 = 1_000_000
export const CWD = 'C:\\work\\bucket-dash'
export const SESSION = { surface: 'terminal', isInteractive: true, cwd: CWD } as const
export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 115, scroll: { offset: 0, bodyRows: 8 }, view: {} }

const STEP_USAGE: TurnUsage = {
  input_tokens: 2,
  output_tokens: 3_651,
  cache_read_input_tokens: 425_512,
  cache_creation_input_tokens: 2_893,
  model: 'claude-opus-5-5',
}

export type World = {
  clock: MockClock
  toasts: string[]
  scripts: string[]
  tail: { output: string; exitCode: number; stderr: string }
  toast: { exitCode: number; stderr: string }
}

export function world(on: On): World {
  const w: World = {
    clock: mock.clock(on, { now: T0 }),
    toasts: [],
    scripts: [],
    tail: { output: '', exitCode: 0, stderr: '' },
    toast: { exitCode: 0, stderr: '' },
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 0 } } }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const script = decodeCommand(e.argv[4] ?? '')
    w.scripts.push(script)
    const answer: ProcessRunResult = script.includes('Get-Content')
      ? { exitCode: w.tail.exitCode, stdout: w.tail.output, stderr: w.tail.stderr, isStdoutTruncated: false, isStderrTruncated: false }
      : { exitCode: w.toast.exitCode, stdout: '', stderr: w.toast.stderr, isStdoutTruncated: false, isStderrTruncated: false }
    return { value: answer }
  })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: STEP_USAGE }
  })
  on('classic.Stop', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  return w
}

export async function runStep($: Engine, agentId?: string): Promise<void> {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, ...(agentId === undefined ? {} : { agentId }) })
  let step = await stream.next()
  while (step.done !== true) step = await stream.next()
}

export function mountBand($: Engine, surface: 'terminal' | 'desktop' = 'terminal', props: typeof BAND_PROPS = BAND_PROPS) {
  return $.ui.mount({ plugin: 'cache-keeper', surface, component: 'AbovePrompt', props })
}
