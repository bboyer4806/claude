// The text New session with handoff writes: the prompt that asks for the brief, the
// saved file, the prompt-box draft, and what it, /handoff, automatic handoff and
// Fresh session say.

export const HANDOFF_PROMPT = [
  'Write a handoff brief so a fresh Claude Code session with no memory of this conversation can continue the work. Reply with the brief only, in Markdown, under 500 words, using these sections:',
  '',
  '## Goal',
  '## Current state',
  '## Decisions and reasons',
  '## Open questions',
  '## Next steps',
  '## Key files and commands',
  '',
  'Be specific: exact file paths, commands, identifiers and values. Leave out finished work the next session does not need. Do not call tools. Do not use em dashes.',
].join('\n')

const STOPPED = 'New session with handoff stopped:'

export const HANDOFF_STARTED = 'Writing a handoff brief. Cache Keeper then starts a new session with the brief in the prompt box.'
export const HANDOFF_BUSY = 'A handoff brief is already being written.'

export function projectName(cwd: string): string {
  return cwd.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? cwd
}

export function handoffFileName(savedAt: number, project: string): string {
  const { date, time } = localStamp(savedAt)
  return `${date}_${time.replace(':', '')}_${project.replace(/[^A-Za-z0-9._-]/g, '-')}.md`
}

export function handoffPath(userProfile: string, fileName: string): string {
  return `${userProfile}\\.claude\\cache-keeper\\handoffs\\${fileName}`
}

export function handoffFileText(i: { brief: string; project: string; savedAt: number; sessionId: string }): string {
  const { date, time } = localStamp(i.savedAt)
  return `# Handoff brief: ${i.project}\n\nSaved ${date} ${time}. Previous session: \`claude --resume ${i.sessionId}\`\n\n${i.brief.trim()}\n`
}

export function handoffDraft(path: string, brief: string): string {
  return `Continue from this handoff brief (saved at ${path}):\n\n${brief.trim()}`
}

export function forkFailureText(r: { reason: string; status?: number | null }): string {
  switch (r.reason) {
    case 'api-error':
      return `${STOPPED} the brief request failed (${r.status ?? 'no status'}).`
    case 'empty-reply':
      return `${STOPPED} the model returned no brief.`
    case 'aborted':
      return `${STOPPED} the brief request was cancelled.`
    case 'nothing-to-fork':
      return `${STOPPED} there is no conversation to hand off yet.`
    default:
      return `${STOPPED} the brief request failed (${r.reason}).`
  }
}

export function stoppedText(message: string, savedPath?: string): string {
  const saved = savedPath === undefined ? '' : ` The brief is saved at ${savedPath}.`
  return `${STOPPED} ${message.replace(/\.$/, '')}.${saved}`
}

export function fillRefusedText(path: string, refusal?: string): string {
  return `Brief saved at ${path}, but it could not be put in the prompt box (${refusal ?? 'refused'}).`
}

export function autoDoneText(path: string, isFilled: boolean): string {
  const where = isFilled ? ' and waiting in the prompt box.' : '.'
  return `You were away and the prompt cache was 5 minutes from going cold, so Cache Keeper started a new session with a handoff brief. The brief is saved at ${path}${where}`
}

export function autoKeptText(path: string): string {
  return `Automatic handoff saved a brief at ${path} but left this session as it was, because you came back.`
}

export function freshStoppedText(message: string): string {
  return `Fresh session stopped: ${message.replace(/\.$/, '')}.`
}

function localStamp(ms: number): { date: string; time: string } {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}
