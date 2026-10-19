import type { Assumption } from '../types'

const MAX_ITEMS = 12

export const EXTRACT_PROMPT = `This is a check from the Assumption Tracker mod, not a new task. Don't use tools and don't continue the work.

Look back at the task you just finished: everything since my last message before this one. List every assumption you made that I didn't explicitly specify. Count any choice you made on my behalf: how you read an ambiguous request, scope (what you included or left out), behavior and defaults, names, file locations, tools, libraries and versions, formats, data, edge cases, and anything you guessed or inferred instead of asking. Leave out what I said outright, and mechanical steps that don't change the result.

Write each one as a short sentence that names the choice you made, starting with a verb, for example "Saved the report as Markdown, not PDF." Most consequential first, at most ${MAX_ITEMS}.

Reply with only the list, as a JSON array of strings inside these tags:
<assumptions>["...", "..."]</assumptions>
If you made no such assumptions, reply <assumptions>[]</assumptions>.`

/** The list from the fork's reply, or null when the reply holds no readable list. */
export function parseAssumptions(reply: string): Assumption[] | null {
  const match = /<assumptions>([\s\S]*?)<\/assumptions>/.exec(reply)
  if (match === null) return null

  let list: unknown
  try {
    list = JSON.parse((match[1] ?? '').trim())
  } catch {
    return null
  }
  if (!Array.isArray(list)) return null

  const texts = list
    .filter((item): item is string => typeof item === 'string')
    .map(text => text.trim())
    .filter(text => text.length > 0)

  return [...new Set(texts)]
    .slice(0, MAX_ITEMS)
    .map((text, i) => ({ id: `a${i + 1}`, text, verdict: null, note: '' }))
}

/** The prompt that asks Claude to fix the wrong assumptions and keep the right ones. */
export function fixPrompt(items: readonly Assumption[]): string {
  const wrong = items.filter(a => a.verdict === 'wrong')
  const right = items.filter(a => a.verdict === 'right')

  const lines = [
    'I reviewed the assumptions you made in your last task. Fix only what I marked wrong, and keep everything else as it is.',
    '',
    'Wrong, fix these:',
    ...wrong.flatMap((a, i) => [
      `${i + 1}. ${a.text}`,
      a.note.trim() !== ''
        ? `   My note: ${a.note.trim()}`
        : "   (No note: work out the right choice from what I asked, and ask me if it's still unclear.)",
    ]),
  ]

  if (right.length > 0) {
    lines.push(
      '',
      'Right, keep these exactly as they are:',
      ...right.map(a => `- ${a.text}${a.note.trim() !== '' ? ` (my note: ${a.note.trim()})` : ''}`),
    )
  }

  lines.push('', "Change only what these fixes need. Don't redo or restyle the rest of the work.")

  return lines.join('\n')
}

export function countLabel(n: number): string {
  return `${n} assumption${n === 1 ? '' : 's'}`
}

export function fixesLabel(n: number): string {
  return `${n} ${n === 1 ? 'fix' : 'fixes'}`
}
