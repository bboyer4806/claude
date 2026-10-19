import type { EngineInterface, On, PluginOptions } from 'claude-code'
import type { Recache, UsageSnapshot } from './band.ts'
import { bandModelOf, bandTree, qualityToastText, recacheOf, warningMessage } from './band.ts'
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
import {
  HANDOFF_BUSY,
  HANDOFF_PROMPT,
  HANDOFF_STARTED,
  autoDoneText,
  autoKeptText,
  fillRefusedText,
  forkFailureText,
  freshStoppedText,
  handoffDraft,
  handoffFileName,
  handoffFileText,
  handoffPath,
  projectName,
  stoppedText,
} from './handoff.ts'
import { powershellArgv, tailScript, toastScript } from './powershell.ts'
import type { AutoSetting } from './threshold.ts'
import { DEFAULT_SETTING, STORE_KEY, autoHandoffReady, autoStatusText, isOverThreshold, parseAutoArgs, settingOf } from './threshold.ts'
import { lastMainUsage } from './transcript.ts'

// Cache Keeper: follows Claude Code's events to keep the cache clock, draws the band
// above the prompt, shows a Windows toast 5 minutes before the cache goes cold, warns
// when the conversation passes the handoff threshold, and runs New session with
// handoff (by button, /handoff, or automatically at the cold-cache warning) and Fresh
// session. This is the only module that calls $; the others are plain functions.

type HandoffOutcome = { kind: 'done'; path: string; isFilled: boolean } | { kind: 'kept'; path: string } | { kind: 'stopped' }

const FRESH_CONFIRM_MS = 5_000

let cache: CacheState = INITIAL_STATE
let usage: UsageSnapshot | undefined
let transcriptErrorShown = false
let handoffRunning = false
let autoSetting: AutoSetting = DEFAULT_SETTING
let qualityWarned = false
let freshArmedAt: number | undefined
let turnRunning = false
let mainTurns = 0

export function register(on: On, options: PluginOptions): void {
  const defaultMinutes = defaultMinutesOf(options)

  on('session.start', async ($, e, next) => {
    usage = await $.session.usage()
    $.clock.every(1_000, () => tick($, defaultMinutes))
    autoSetting = settingOf(await $.store.get(STORE_KEY))
    await registerCommands($)
    checkQuality($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    usage = e
    checkQuality($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turnRunning = true
      mainTurns += 1
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) turnRunning = false
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
      freshArmedAt = undefined
    }
    if (e.source === 'resume' || e.source === 'fork') {
      cache = onResume(cache, await $.clock.now(), e)
      void readCacheWindow($, e.transcript_path)
    }
    if (e.source !== 'startup') {
      usage = await $.session.usage()
      checkQuality($)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    cache = onModelSwitch(cache, e)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'handoff' }, async ($) => {
    if (handoffRunning) return { text: HANDOFF_BUSY }
    // The brief's /clear waits for the session to be idle, so it cannot run inside
    // this command: start it once the command is done.
    $.clock.after(0, () => void handoffAndClear($))
    return { text: HANDOFF_STARTED }
  })

  on('command.run', { command: 'autohandoff' }, async ($, e) => {
    autoSetting = settingOf(await $.store.get(STORE_KEY))
    const parsed = parseAutoArgs(e.args, autoSetting)
    if (parsed.kind === 'error') return { text: parsed.text }
    if (parsed.kind === 'set') {
      await $.store.set(STORE_KEY, parsed.setting)
      autoSetting = parsed.setting
      checkQuality($)
      $.ui.invalidate('ui.render')
    }
    return { text: autoStatusText(autoSetting) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const now = await $.clock.now()
    const model = bandModelOf({
      cache,
      usage,
      now,
      defaultMinutes,
      isWorking: e.props.isWorking,
      handoffRunning,
      threshold: autoSetting.threshold,
      freshArmed: freshArmedAt !== undefined && now - freshArmedAt < FRESH_CONFIRM_MS,
    })
    return bandTree(
      $.ui.resolve(e),
      model,
      async () => {
        await handoffAndClear($)
      },
      () => freshSession($),
    )
  })
}

async function registerCommands($: EngineInterface): Promise<void> {
  try {
    await $.command.register({ name: 'handoff', description: 'Write a handoff brief, then start a new session with it in the prompt box.' })
    await $.command.register({
      name: 'autohandoff',
      description: 'Show or set automatic handoff: on, off, or a threshold such as 50% or 200k.',
      argumentHint: 'on | off | 50% | 200k',
    })
  } catch (error) {
    $.ui.toast(`Cache Keeper could not add /handoff and /autohandoff: ${messageOf(error)}`, { timeoutMs: 10_000 })
  }
}

// Toasts once each time the conversation crosses the threshold; dropping back under
// it (after a /clear or /compact, or under a higher threshold) re-arms the toast.
function checkQuality($: EngineInterface): void {
  const context = usage?.context
  const isOver = isOverThreshold(autoSetting.threshold, context)
  if (isOver && !qualityWarned && context?.tokens !== undefined) {
    $.ui.toast(qualityToastText({ tokens: context.tokens, percent: context.percent }, autoSetting.threshold), { timeoutMs: 10_000 })
  }
  qualityWarned = isOver
}

// The first press arms it; a second within 5 seconds clears without a brief.
async function freshSession($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  if (freshArmedAt === undefined || now - freshArmedAt >= FRESH_CONFIRM_MS) {
    freshArmedAt = now
    $.ui.invalidate('ui.render')
    return
  }
  freshArmedAt = undefined
  try {
    await $.command.run({ command: 'clear' })
  } catch (error) {
    $.ui.toast(freshStoppedText(messageOf(error)), { timeoutMs: 10_000 })
  } finally {
    $.ui.invalidate('ui.render')
  }
}

// Writes the brief from the session's own conversation, saves it, clears the
// session, then puts the brief in the prompt box. Never clears without a saved brief.
// `keepSession`, asked once the brief is saved, can stop it short of the clear.
async function handoffAndClear($: EngineInterface, keepSession?: () => Promise<boolean>): Promise<HandoffOutcome> {
  if (handoffRunning) return { kind: 'stopped' }
  handoffRunning = true
  $.ui.invalidate('ui.render')
  let savedPath: string | undefined
  try {
    const reply = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!reply.isAnswered) {
      $.ui.toast(forkFailureText(reply), { timeoutMs: 10_000 })
      return { kind: 'stopped' }
    }
    const userProfile = await $.env.get("USERPROFILE")
    if (!userProfile) throw new Error('USERPROFILE is not set')
    const project = projectName(await $.session.cwd())
    const savedAt = await $.clock.now()
    const path = handoffPath(userProfile, handoffFileName(savedAt, project))
    await $.fs.write(path, handoffFileText({ brief: reply.text, project, savedAt, sessionId: await $.session.id() }))
    savedPath = path
    if (keepSession !== undefined && (await keepSession())) return { kind: 'kept', path }
    await $.command.run({ command: 'clear' })
    const filled = await $.prompt.fill({ text: handoffDraft(path, reply.text) })
    if (!filled.isFilled) $.ui.toast(fillRefusedText(path, filled.refusal), { timeoutMs: 10_000 })
    return { kind: 'done', path, isFilled: filled.isFilled }
  } catch (error) {
    $.ui.toast(stoppedText(messageOf(error), savedPath), { timeoutMs: 10_000 })
    return { kind: 'stopped' }
  } finally {
    handoffRunning = false
    $.ui.invalidate('ui.render')
  }
}

// At the cold-cache warning: hand off if the person is away and the conversation is
// past the threshold, else warn as usual.
async function warnOrHandOff($: EngineInterface, project: string, recache: Recache | undefined): Promise<void> {
  // Read the setting again: another session may have changed it.
  autoSetting = settingOf(await $.store.get(STORE_KEY))
  if (!autoSetting.isOn) return showColdWarning($, project, recache)
  const isReady = autoHandoffReady({
    setting: autoSetting,
    context: usage?.context,
    hasTurn: cache.hasTurn,
    turnRunning,
    handoffRunning,
    draft: (await $.prompt.read()).text,
  })
  if (!isReady) return showColdWarning($, project, recache)
  const turnsAtStart = mainTurns
  const outcome = await handoffAndClear($, async () => mainTurns !== turnsAtStart || turnRunning || (await $.prompt.read()).text.trim() !== '')
  switch (outcome.kind) {
    case 'done':
      return showWindowsToast($, `Cache Keeper: ${project}`, autoDoneText(outcome.path, outcome.isFilled))
    case 'kept':
      $.ui.toast(autoKeptText(outcome.path), { timeoutMs: 10_000 })
      return
    case 'stopped':
      return showColdWarning($, project, recache)
  }
}

async function tick($: EngineInterface, defaultMinutes: number): Promise<void> {
  // Read the clock first: a step can land during the await, and the view and the
  // warning check must both see the cache as it is after it.
  const now = await $.clock.now()
  const view = cacheView(cache, now, defaultMinutes)
  if (shouldWarn(cache, view)) {
    cache = onWarned(cache)
    void warnOrHandOff($, projectName(await $.session.cwd()), recacheOf(cache, defaultMinutes))
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

function showColdWarning($: EngineInterface, project: string, recache: Recache | undefined): Promise<void> {
  const { title, body } = warningMessage(project, recache)
  return showWindowsToast($, title, body)
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
