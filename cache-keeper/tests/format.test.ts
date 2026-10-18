import { expect, test } from 'claude-code/testing'
import { formatCountdown, formatDuration, formatTokens, formatUsd } from '../hooks/format.ts'

test('formatTokens', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(182_400)).toBe('182.4k')
  expect(formatTokens(182_000)).toBe('182k')
  expect(formatTokens(999_960)).toBe('1M')
  expect(formatTokens(1_260_000)).toBe('1.3M')
})

test('formatUsd', () => {
  expect(formatUsd(1.4592)).toBe('$1.46')
  expect(formatUsd(12.8)).toBe('$12.80')
  expect(formatUsd(0)).toBe('$0.00')
  expect(formatUsd(0.004)).toBe('<$0.01')
})

test('formatCountdown rounds up to whole seconds', () => {
  expect(formatCountdown(2_832_000)).toBe('47:12')
  expect(formatCountdown(3_600_000)).toBe('60:00')
  expect(formatCountdown(58_200)).toBe('0:59')
  expect(formatCountdown(0)).toBe('0:00')
})

test('formatDuration drops a zero trailing unit', () => {
  expect(formatDuration(7_800_000)).toBe('2h10m')
  expect(formatDuration(7_200_000)).toBe('2h')
  expect(formatDuration(2_700_000)).toBe('45m')
  expect(formatDuration(273_600_000)).toBe('3d4h')
  expect(formatDuration(259_200_000)).toBe('3d')
  expect(formatDuration(30_000)).toBe('<1m')
})
