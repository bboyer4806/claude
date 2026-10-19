import { expect, test } from 'claude-code/testing'
import { HANDOFF_PROMPT, autoDoneText, autoKeptText, fillRefusedText, forkFailureText, freshStoppedText, handoffDraft, handoffFileName, handoffFileText, handoffPath, projectName, stoppedText } from '../hooks/handoff.ts'

const AT = new Date(2026, 9, 18, 14, 32).getTime()

test('projectName takes the last folder of a Windows or POSIX path', () => {
  expect(projectName('C:\\Users\\Brian\\code\\bucket-dash')).toBe('bucket-dash')
  expect(projectName('/home/brian/proj/')).toBe('proj')
})

test('the file name uses local time and a safe project name', () => {
  expect(handoffFileName(AT, "Brian's app")).toBe('2026-10-18_1432_Brian-s-app.md')
  expect(handoffPath('C:\\Users\\Brian', 'x.md')).toBe('C:\\Users\\Brian\\.claude\\cache-keeper\\handoffs\\x.md')
})

test('the file heads the brief with the project, time and resume command', () => {
  expect(handoffFileText({ brief: '\n## Goal\nShip it.\n\n', project: 'bucket-dash', savedAt: AT, sessionId: 'abc123' }))
    .toBe('# Handoff brief: bucket-dash\n\nSaved 2026-10-18 14:32. Previous session: `claude --resume abc123`\n\n## Goal\nShip it.\n')
})

test('the draft names the saved file above the brief', () => {
  expect(handoffDraft('C:\\h.md', '## Goal\nShip it.\n')).toBe('Continue from this handoff brief (saved at C:\\h.md):\n\n## Goal\nShip it.')
})

test('failure messages', () => {
  expect(forkFailureText({ reason: 'api-error', status: 529 })).toBe('New session with handoff stopped: the brief request failed (529).')
  expect(forkFailureText({ reason: 'api-error', status: null })).toBe('New session with handoff stopped: the brief request failed (no status).')
  expect(forkFailureText({ reason: 'empty-reply' })).toBe('New session with handoff stopped: the model returned no brief.')
  expect(forkFailureText({ reason: 'aborted' })).toBe('New session with handoff stopped: the brief request was cancelled.')
  expect(forkFailureText({ reason: 'nothing-to-fork' })).toBe('New session with handoff stopped: there is no conversation to hand off yet.')
  expect(stoppedText('USERPROFILE is not set')).toBe('New session with handoff stopped: USERPROFILE is not set.')
  expect(stoppedText('disk full.')).toBe('New session with handoff stopped: disk full.')
  expect(stoppedText('clear failed', 'C:\\h.md')).toBe('New session with handoff stopped: clear failed. The brief is saved at C:\\h.md.')
  expect(fillRefusedText('C:\\h.md', 'dialog')).toBe('Brief saved at C:\\h.md, but it could not be put in the prompt box (dialog).')
  expect(fillRefusedText('C:\\h.md')).toBe('Brief saved at C:\\h.md, but it could not be put in the prompt box (refused).')
})

test('the prompt asks for the six sections, text only', () => {
  for (const part of ['## Goal', '## Current state', '## Decisions and reasons', '## Open questions', '## Next steps', '## Key files and commands', 'Do not call tools.']) {
    expect(HANDOFF_PROMPT).toContain(part)
  }
})

test('what automatic handoff and Fresh session say', () => {
  expect(autoDoneText('C:\\h.md', true)).toBe(
    'You were away and the prompt cache was 5 minutes from going cold, so Cache Keeper started a new session with a handoff brief. The brief is saved at C:\\h.md and waiting in the prompt box.',
  )
  expect(autoDoneText('C:\\h.md', false)).toBe(
    'You were away and the prompt cache was 5 minutes from going cold, so Cache Keeper started a new session with a handoff brief. The brief is saved at C:\\h.md.',
  )
  expect(autoKeptText('C:\\h.md')).toBe('Automatic handoff saved a brief at C:\\h.md but left this session as it was, because you came back.')
  expect(freshStoppedText('clear failed')).toBe('Fresh session stopped: clear failed.')
})
