import type { EngineInterface, On, PluginOptions } from 'claude-code'
import type { UsageSnapshot } from './band.ts'
import { bandModelOf, bandTree, recacheOf, warningMessage } from './band.ts'
import type { CacheState } from './cache-clock.ts'
import {
  INITIAL_STATE,
  cacheView,
  defaultMinutesOf,
  onModelSwitch,
  onReset,
  onResume,
  onStep,
  onTranscript,
  onWarned,
  shouldWarn,
} from './cache-clock.ts'
import { projectName } from './handoff.ts'
import { powershellArgv, tailScript, toastScript } from './powershell.ts'
import { lastMainUsage } from './transcript.ts'

// Cache Keeper: follows Claude Code's events to keep the cache clock, draws the band
// above the prompt, and shows a Windows toast 5 minutes before the cache goes cold.
// This is the only module that calls $; the others are plain functions.

let cache: CacheState = INITIAL_STATE
let usage: UsageSnapshot | undefined
let transcriptErrorShown = false

export function register(on: On, options: PluginOptions): void {
  const defaultMinutes = defaultMinutesOf(options)

  on('session.start', async ($, e, next) => {
    usage = await $.session.usage()
    $.clock.every(1_000, () => tick($, defaultMinutes))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    usage = e
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const sentAt = e.agentId === undefined ? await $.clock.now() : undefined
    const result = yield* next(e)
    if (sentAt !== undefined && result.usage !== null) {
      cache = onStep(cache, sentAt, result.usage)
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('classic.Stop', async ($, e, next) => {
    void readCacheWindow($, e.transcript_path)
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'compact') {
      cache = onReset(cache)
    }
    if (e.source === 'resume' || e.source === 'fork') {
      cache = onResume(cache, await $.clock.now(), e)
      void readCacheWindow($, e.transcript_path)
    }
    if (e.source !== 'startup') {
      usage = await $.session.usage()
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    cache = onModelSwitch(cache, e)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const model = bandModelOf({ cache, usage, now: await $.clock.now(), defaultMinutes })
    return bandTree($.ui.resolve(e), model)
  })
}

async function tick($: EngineInterface, defaultMinutes: number): Promise<void> {
  const view = cacheView(cache, await $.clock.now(), defaultMinutes)
  if (shouldWarn(cache, view)) {
    cache = onWarned(cache)
    const { title, body } = warningMessage(projectName(await $.session.cwd()), recacheOf(cache, defaultMinutes))
    void showWindowsToast($, title, body)
  }
  $.ui.invalidate('ui.render')
}

async function readCacheWindow($: EngineInterface, transcriptPath: string): Promise<void> {
  try {
    const run = await $.process.run(powershellArgv(tailScript(transcriptPath)), { timeoutMs: 15_000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `exit code ${run.exitCode}`)
    const info = lastMainUsage(run.stdout)
    if (info === undefined) return
    cache = onTranscript(cache, info)
    $.ui.invalidate('ui.render')
  } catch (error) {
    if (transcriptErrorShown) return
    transcriptErrorShown = true
    $.ui.toast(`Cache Keeper could not read the cache window: ${messageOf(error)}`, { timeoutMs: 10_000 })
  }
}

async function showWindowsToast($: EngineInterface, title: string, body: string): Promise<void> {
  try {
    const run = await $.process.run(powershellArgv(toastScript(title, body)), { timeoutMs: 15_000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `exit code ${run.exitCode}`)
  } catch (error) {
    $.ui.toast(`Cache Keeper could not show a Windows notification: ${messageOf(error)}`, { timeoutMs: 10_000 })
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
