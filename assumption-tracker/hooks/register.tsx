import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'

import type { Assumption, AssumptionSet, Verdict } from '../types'
import { countLabel, EXTRACT_PROMPT, fixesLabel, fixPrompt, parseAssumptions } from './prompts'

const PANE = 'assumptions'

const current = atom({ plugin: 'assumption-tracker', key: 'current' } as const, null)
const focused = atom({ plugin: 'assumption-tracker', key: 'focused' } as const, null)

type Engine = EngineInterface

export const register: Register = on => {
  // Not drawn, so a module variable will do; a reload resets it to idle.
  let isWorking = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'assumptions',
      description: 'Review the assumptions Claude made in its last task',
    })

    return next(e)
  })

  on('command.run', { command: 'assumptions' }, async $ => {
    const set = await read($, current)
    if (set?.status === 'collecting') return { text: 'Still collecting the assumptions from the last task.' }
    if (set === null || set.items.length === 0) return { text: 'No assumptions recorded for the last task.' }

    await openReview($)

    return { text: `Opened the review of ${countLabel(set.items.length)}.` }
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) isWorking = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done

    isWorking = false
    if (e.reason !== 'answer') return done

    const turnId = e.turnId
    await update($, current, (): AssumptionSet => ({ turnId, status: 'collecting', items: [] }))
    // The fork takes a few seconds; run it after this dispatch so the turn ends now.
    $.clock.after(0, () => void collect($, turnId))

    return done
  })

  // Typing 0 in an empty prompt box presses the band's `0` hotkey; this is the
  // fallback for a surface that hands the key to the box instead.
  on('prompt.edit', async ($, e, next) => {
    if (e.text !== '' || e.inputText !== '0' || isWorking) return next(e)

    const set = await read($, current)
    if (set?.status !== 'ready' || set.items.length === 0) return next(e)

    await openReview($)

    return { text: e.text, cursor: e.cursor }
  })

  // The band is shared with other mods' strips (Cache Keeper's): keep what is drawn
  // beneath, under this one. Outside a survey the engine's own drawing is empty.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey || e.props.isWorking) return below

    const set = await read($, current)
    if (set === null || set.status === 'reviewed') return below

    const { Box, Button, Text } = $.ui.resolve(e)
    const withBelow = (mine: RenderElement) =>
      below.type === 'engine' ? mine : (
        <Box flexDirection="column">
          {mine}
          {below}
        </Box>
      )

    if (set.status === 'collecting') {
      return withBelow(<Text dimColor>Checking what Claude assumed…</Text>)
    }
    if (set.items.length === 0) return below

    return withBelow(
      <Box gap={1}>
        <Text>Claude made {countLabel(set.items.length)}.</Text>
        <Button key="review" plain hotkey="0" dimColor onPress={() => openReview($)}>
          review
        </Button>
      </Box>,
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const Input = 'Input' in table ? table.Input : undefined

    const set = await read($, current)
    const at = await read($, focused)

    if (set === null || set.items.length === 0) {
      return <Text dimColor>No assumptions to review.</Text>
    }

    const isFrozen = set.status === 'reviewed'
    const wrong = set.items.filter(a => a.verdict === 'wrong').length
    const right = set.items.filter(a => a.verdict === 'right').length

    const row = (a: Assumption, i: number) => {
      const isAt = a.id === at

      return (
        <Box key={`item:${a.id}`} flexDirection="column">
          <Text bold={isAt} wrap="wrap">
            {isAt ? '› ' : '  '}
            {i + 1}. {a.text}
          </Text>
          <Box gap={1} paddingLeft={5}>
            {isFrozen ? (
              <Text color={a.verdict === 'wrong' ? 'error' : a.verdict === 'right' ? 'success' : 'subtle'}>
                {a.verdict === 'wrong' ? '✗ Wrong' : a.verdict === 'right' ? '✓ Right' : 'Not marked'}
              </Text>
            ) : (
              [
                <Button
                  key={`right:${a.id}`}
                  label="✓ Right"
                  variant={a.verdict === 'right' ? 'primary' : undefined}
                  dimColor={a.verdict === 'wrong'}
                  autoFocus={i === 0 ? true : undefined}
                  onPress={press => mark($, a.id, 'right', press.surface)}
                />,
                <Button
                  key={`wrong:${a.id}`}
                  label="✗ Wrong"
                  variant={a.verdict === 'wrong' ? 'primary' : undefined}
                  dimColor={a.verdict === 'right'}
                  onPress={press => mark($, a.id, 'wrong', press.surface)}
                />,
              ]
            )}
          </Box>
          {Input !== undefined && !isFrozen ? (
            <Box paddingLeft={5}>
              <Input
                key={`note:${a.id}`}
                label="Note: "
                placeholder={a.verdict === 'wrong' ? 'what it should be (optional)' : 'optional'}
                value={a.note}
                submitLabel="next"
                onInput={value => setNote($, a.id, value)}
                onSubmit={async value => {
                  await setNote($, a.id, value)
                  await focusAfter($, a.id)
                }}
              />
            </Box>
          ) : a.note !== '' ? (
            <Box paddingLeft={5}>
              <Text dimColor>Note: {a.note}</Text>
            </Box>
          ) : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Text>
          {isFrozen ? 'You reviewed' : 'Claude made'} {countLabel(set.items.length)}.{' '}
          <Text dimColor>
            {isFrozen
              ? `${right} right, ${wrong} wrong.`
              : `Tab moves through them, Enter marks. Closing sends ${wrong > 0 ? fixesLabel(wrong) : 'any fixes'} to Claude.`}
          </Text>
        </Text>
        {set.items.map(row)}
        <Box gap={1}>
          <Button
            key="done"
            variant="primary"
            label={isFrozen ? 'Close' : wrong > 0 ? `Send ${fixesLabel(wrong)} to Claude` : 'Done'}
            onPress={() => finish($)}
          />
        </Box>
      </Box>
    )
  })

  // Highlight the assumption the focus ring is on, so Tab visibly walks the list.
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const result = await next(e)
    const id = e.element?.split(':')[1]
    if (result.deny === undefined && id !== undefined) await update($, focused, () => id)

    return result
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const result = await next(e)
    if (e.origin.kind === 'person') await finalize($)

    return result
  })
}

async function collect($: Engine, turnId: string): Promise<void> {
  let items: Assumption[] | null = null
  try {
    const reply = await $.model.fork({ prompt: EXTRACT_PROMPT })
    items = reply.isAnswered ? parseAssumptions(reply.text) : null
    if (items === null) {
      const why = reply.isAnswered ? 'the reply held no list' : reply.reason
      $.ui.log(`assumption-tracker: no assumptions collected (${why})`, { to: 'debug' })
    }
  } catch (error) {
    $.ui.log(`assumption-tracker: the fork failed (${String(error)})`, { to: 'debug' })
  }

  const found = items
  await update($, current, (set): AssumptionSet | null => {
    if (set === null || set.turnId !== turnId) return set
    if (found === null || found.length === 0) return null

    return { ...set, status: 'ready', items: found }
  })
}

async function openReview($: Engine): Promise<void> {
  const set = await read($, current)
  if (set === null || set.items.length === 0) return

  await update($, focused, () => set.items[0]?.id ?? null)
  await $.ui.open({
    id: PANE,
    title: 'Assumptions',
    focus: true,
    closeOnEscape: true,
    holdToasts: true,
    rows: Math.min(4 + set.items.length * 4, 40),
  })
}

async function mark($: Engine, id: string, verdict: Verdict, surface: RenderSurface): Promise<void> {
  const set = await update($, current, s =>
    s === null || s.status !== 'ready'
      ? s
      : {
          ...s,
          // Pressing the verdict an item already has clears it.
          items: s.items.map(a => (a.id === id ? { ...a, verdict: a.verdict === verdict ? null : verdict } : a)),
        },
  )
  const item = set?.items.find(a => a.id === id)

  if (item?.verdict === 'wrong' && surface !== 'mobile') {
    await focusKey($, `note:${id}`)
  } else if (item?.verdict === 'right') {
    await focusAfter($, id)
  }
}

async function setNote($: Engine, id: string, note: string): Promise<void> {
  await update($, current, s =>
    s === null || s.status !== 'ready' ? s : { ...s, items: s.items.map(a => (a.id === id ? { ...a, note } : a)) },
  )
}

/** Moves the focus to the next assumption's Right button, or to the send button after the last. */
async function focusAfter($: Engine, id: string): Promise<void> {
  const set = await read($, current)
  const items = set?.items ?? []
  const following = items[items.findIndex(a => a.id === id) + 1]

  await focusKey($, following === undefined ? 'done' : `right:${following.id}`)
}

async function focusKey($: Engine, key: string): Promise<void> {
  try {
    const moved = await $.ui.focus({ requestId: PANE, key })
    if (moved.deny !== undefined) $.ui.log(`assumption-tracker: focus stayed (${moved.deny})`, { to: 'debug' })
  } catch (error) {
    // The pane gave up the keyboard; the person moves on by hand.
    $.ui.log(`assumption-tracker: focus stayed (${String(error)})`, { to: 'debug' })
  }
}

async function finish($: Engine): Promise<void> {
  await finalize($)
  await $.ui.close({ id: PANE })
}

/** Freezes the review once, and sends the fix prompt when anything was marked wrong. */
async function finalize($: Engine): Promise<void> {
  const claimed: { set?: AssumptionSet } = {}
  await update($, current, (s): AssumptionSet | null => {
    if (s === null || s.status !== 'ready') {
      delete claimed.set
      return s
    }
    claimed.set = s

    return { ...s, status: 'reviewed' }
  })

  const set = claimed.set
  if (set === undefined) return

  const wrong = set.items.filter(a => a.verdict === 'wrong').length
  if (wrong === 0) return

  await $.prompt.submit({ text: fixPrompt(set.items), asUser: true })
  $.ui.toast(`Sent ${fixesLabel(wrong)} to Claude`)
}
