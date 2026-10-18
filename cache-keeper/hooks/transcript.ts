import type { TranscriptInfo, Ttl } from './cache-clock.ts'

// Which TTL a response's cache writes used, read as Claude Code reads it:
// any 5-minute write means 5m, else any 1-hour write means 1h.
export function ttlFromUsage(usage: unknown): Ttl | undefined {
  const creation = recordOf(recordOf(usage)?.cache_creation)
  if (numberOf(creation?.ephemeral_5m_input_tokens) > 0) return '5m'
  if (numberOf(creation?.ephemeral_1h_input_tokens) > 0) return '1h'
  return undefined
}

// The newest main-conversation assistant row among transcript lines, oldest first.
export function lastMainUsage(output: string): TranscriptInfo | undefined {
  const lines = output.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const row = recordOf(parseJson(lines[i] ?? ''))
    if (row?.type !== 'assistant' || row.isSidechain === true) continue
    const message = recordOf(row.message)
    const usage = recordOf(message?.usage)
    if (typeof message?.model !== 'string' || usage === undefined) continue
    return { model: message.model, ttl: ttlFromUsage(usage), speed: stringOf(usage.speed), geo: stringOf(usage.inference_geo) }
  }
  return undefined
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
