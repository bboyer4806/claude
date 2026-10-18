import { expect, test } from 'claude-code/testing'
import { encodeCommand, powershellArgv, psQuote, tailScript, toastScript } from '../hooks/powershell.ts'
import { decodeCommand } from './fixtures.ts'

test('psQuote doubles straight and curly single quotes', () => {
  expect(psQuote("C:\\Users\\O'Brien")).toBe("'C:\\Users\\O''Brien'")
  expect(psQuote('Brian’s app')).toBe("'Brian’’s app'")
})

test('encodeCommand is base64 of UTF-16LE', () => {
  expect(encodeCommand('a')).toBe('YQA=')
  expect(decodeCommand(encodeCommand('Ünïcode ✓ $x'))).toBe('Ünïcode ✓ $x')
})

test('powershellArgv runs an encoded script without a profile', () => {
  expect(powershellArgv('Write-Output 1')).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodeCommand('Write-Output 1')])
})

test('tailScript keeps the last 3 of the last 200 lines that carry cache writes', () => {
  expect(tailScript("C:\\Users\\O'Brien\\t.jsonl")).toBe([
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "Get-Content -LiteralPath 'C:\\Users\\O''Brien\\t.jsonl' -Tail 200 -Encoding UTF8 | Where-Object { $_.Contains('\"cache_creation\":{') } | Select-Object -Last 3",
  ].join('\n'))
})

test("toastScript escapes the text and shows it under PowerShell's app id", () => {
  const script = toastScript('Cache Keeper: Brian’s app', 'Costs $1.46 & more <soon>')
  expect(script).toContain("Escape('Cache Keeper: Brian’’s app')")
  expect(script).toContain("Escape('Costs $1.46 & more <soon>')")
  expect(script).toContain("CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')")
})
