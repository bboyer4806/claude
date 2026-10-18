import { expect, test } from 'claude-code/testing'
import { lastMainUsage, ttlFromUsage } from '../hooks/transcript.ts'
import { assistantRow, progressRow } from './fixtures.ts'

test('ttlFromUsage mirrors Claude Code: 5m writes win, then 1h writes', () => {
  expect(ttlFromUsage({ cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 5 } })).toBe('5m')
  expect(ttlFromUsage({ cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 5 } })).toBe('1h')
  expect(ttlFromUsage({ cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } })).toBeUndefined()
  expect(ttlFromUsage(undefined)).toBeUndefined()
})

test('lastMainUsage takes the last main assistant row, across CRLF lines', () => {
  const out = [assistantRow({ ttl1h: 2_893 }), assistantRow({ ttl5m: 700, speed: 'fast', geo: 'us', model: 'claude-opus-5' })].join('\r\n')
  expect(lastMainUsage(out)).toEqual({ model: 'claude-opus-5', ttl: '5m', speed: 'fast', geo: 'us' })
})

test('lastMainUsage skips cut-off lines, subagent rows and rows that only embed usage', () => {
  const main = assistantRow({ ttl1h: 2_893 })
  const out = [main, progressRow(), assistantRow({ ttl5m: 9, isSidechain: true }), main.slice(0, 120)].join('\n')
  expect(lastMainUsage(out)).toEqual({ model: 'claude-opus-5-5', ttl: '1h', speed: 'standard', geo: 'global' })
})

test('lastMainUsage returns nothing for empty output', () => {
  expect(lastMainUsage('')).toBeUndefined()
})
