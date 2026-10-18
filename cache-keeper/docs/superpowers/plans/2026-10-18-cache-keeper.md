# Cache Keeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cache Keeper mod: a strip above the Claude Code prompt with a cache countdown, context, usage limits, session cost and re-cache cost, a 5-minute Windows toast, and a Handoff & Clear button.

**Architecture:** A Claude Code mod, which is a plugin with a TypeScript hooks module. Pure modules hold all the logic: cache clock, pricing, transcript parsing, PowerShell scripts, handoff text, band layout and formatting. `hooks/register.ts` is the only file that touches `$`, and it wires events to those modules. Windows PowerShell reads the transcript tail for the cache window and shows Windows toasts.

**Tech Stack:** Claude Code 2.1.302 mods API (TypeScript on Bun), the `claude plugin test` kit, TypeScript 5.9 (`tsc`), Windows PowerShell 5.1. For script checks in the dev container: pwsh 7 and Node 22.

**Spec:** `docs/superpowers/specs/2026-10-18-cache-keeper-design.md`

## Global Constraints

- Claude Code 2.1.302 or later. Types come from its declarations, copied to `.claude-plugin/types/claude-code/index.d.ts` (gitignored, dev only).
- Runs on Windows 10/11 through `powershell.exe` (Windows PowerShell 5.1), in the terminal CLI and the Desktop app's Code tab.
- Only `hooks/register.ts` uses `$`, inside hooks or top-level functions of that file. Every other module is pure and never receives `$`. This is a validator rule.
- `on(...)` event names are string literals. Imports are relative, with `.ts` extensions. Type imports use `import type`.
- Time comes from `$.clock.now()`, never `Date.now()`. `Date` is only used to format and parse.
- No em dashes in any text the user sees: band, toasts, brief prompt, README.
- Prices are the spec's "Re-cache cost" values (platform.claude.com pricing, 2026-10-18).
- Tools: `claude` is Claude Code 2.1.302, `tsc` is TypeScript 5.9, `pwsh` is PowerShell 7, `node` is Node 22.
- "Checks pass" means all three succeed from the repo root: `claude plugin test`, `claude plugin validate .` (with `--strict` from Task 8 on), and `tsc -p .`.
- Commit messages end with the session's Co-Authored-By and Claude-Session lines.

## Review Focus

1. **Quotes in paths and names.** A transcript path or project folder with an apostrophe or curly quote (`C:\Users\O'Brien`, `Brian’s app`) must reach PowerShell intact. Test: Task 5, `psQuote`.
2. **Messy tail output.** The last line may be cut off, or a row that isn't a main assistant row may contain `"cache_creation":{` (progress rows, subagent rows). Parsing must skip those and still find the last main row. Test: Task 4.
3. **Waking after sleep.** If the computer sleeps past the warning time, the first tick after waking finds the cache cold and must not toast. Test: Task 2, `shouldWarn` on a cold view.
4. **Model id variants.** Ids with suffixes (`[1m]`, a date) price by family. Unknown models show `no price for <model>`. Test: Tasks 3 and 7.
5. **Handoff failing midway.** A fork error, a refused write, `/clear` failing or `USERPROFILE` unset must never clear without a saved brief, and once the brief is saved the message names its path. Test: Task 9.

---

### Task 1: Scaffold the mod and the formatting helpers

**Files:**
- Create: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`, `tsconfig.json`, `hooks/format.ts`
- Create, dev only and already gitignored: `.claude-plugin/types/claude-code/index.d.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Produces: `formatTokens(n: number): string`, `formatUsd(n: number): string`, `formatCountdown(ms: number): string`, `formatDuration(ms: number): string`. Also `register(on: On, options: PluginOptions): void`, empty for now.

- [ ] **Step 1: Add the declarations and config files**

`.claude-plugin/types/claude-code/index.d.ts`: the line `// Written by Claude Code 2.1.302.` followed by the declarations extracted from the 2.1.302 binary.

`.claude-plugin/plugin.json`:

```json
{
  "name": "cache-keeper",
  "version": "0.1.0",
  "description": "Keeps the prompt cache in view: countdown to cold, context, usage limits, session cost, a 5-minute Windows warning, and Handoff & Clear.",
  "author": { "name": "Brian Boyer" },
  "userConfig": {
    "default_cache_minutes": {
      "type": "number",
      "title": "Default cache window (minutes)",
      "description": "Used until Claude Code reports the real cache window.",
      "default": 60,
      "min": 1,
      "max": 60
    }
  }
}
```

`hooks/hooks.json` is `{ "modules": ["./register.ts"] }`. `hooks/register.ts` exports an empty `register(on: On, options: PluginOptions): void`.

`tsconfig.json`: target and lib `es2023`, `types: []`, module `esnext`, moduleResolution `bundler`, `strict`, `noUncheckedIndexedAccess`, `noEmit`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `skipLibCheck`. Include `hooks`, `tests` and `.claude-plugin/types`.

- [ ] **Step 2: Write the failing test**

```ts
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
```

- [ ] **Step 3: Run `claude plugin test`**

Expected: FAIL, because `../hooks/format.ts` is missing.

- [ ] **Step 4: Implement `hooks/format.ts`**

- Tokens: below 1,000, the number as is. Otherwise one decimal in `k`, dropping `.0`. Once the `k` value rounds to 1,000 or more, one decimal in `M`.
- Money: two decimals. A positive amount below $0.005 is `<$0.01`.
- Countdown: round up to whole seconds and write `m:ss`.
- Duration: round down to whole minutes and write `<1m`, `Nm`, `NhMm` or `NdHh`, dropping a zero trailing unit.

- [ ] **Step 5: Checks pass, then commit**

Commit message: "Scaffold the mod and add formatting helpers".

---

### Task 2: Cache clock

**Files:**
- Create: `hooks/cache-clock.ts`
- Test: `tests/cache-clock.test.ts`

**Interfaces:**
- Produces:
  - `type Ttl = '5m' | '1h'`
  - `type StepUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; model: string }`
  - `type CacheState = { readonly hasTurn: boolean; readonly anchorAt?: number; readonly ttl?: Ttl; readonly basisTokens?: number; readonly model?: string; readonly speed?: string; readonly geo?: string; readonly warnedFor?: number }`
  - `type TranscriptInfo = { model: string; ttl?: Ttl; speed?: string; geo?: string }`
  - `type CacheView = { kind: 'none'; ttlLabel: string } | { kind: 'warm'; ttlLabel: string; remainingMs: number; isWarning: boolean } | { kind: 'cold'; ttlLabel: string }`
  - `const WARN_MS = 300_000` and `const INITIAL_STATE: CacheState = { hasTurn: false }`
  - `defaultMinutesOf(options: Readonly<Record<string, unknown>>): number`. Throws `Error('cache-keeper: default_cache_minutes must be a whole number from 1 to 60')` otherwise.
  - Transitions, each returning a new state:
    - `onStep(s, sentAt: number, usage: StepUsage)`
    - `onReset(s)`
    - `onResume(s, now: number, e: { seconds_since_last_response?: number; context_tokens?: number; model?: string })`
    - `onModelSwitch(s, e: { to_model: string; cache_ttl: Ttl; context_tokens: number })`
    - `onTranscript(s, info: TranscriptInfo)`
    - `onWarned(s)`
  - Reads:
    - `ttlMsOf(s, defaultMinutes): number`
    - `pricingTtlOf(s, defaultMinutes): Ttl`
    - `cacheView(s, now: number, defaultMinutes: number): CacheView`
    - `shouldWarn(s, view: CacheView): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'claude-code/testing'
import { INITIAL_STATE, cacheView, defaultMinutesOf, onModelSwitch, onReset, onResume, onStep, onTranscript, onWarned, pricingTtlOf, shouldWarn } from '../hooks/cache-clock.ts'

const T0 = 1_000_000
const USAGE = { input_tokens: 2, output_tokens: 3_651, cache_read_input_tokens: 425_512, cache_creation_input_tokens: 2_893, model: 'claude-opus-5-5' }
const stepped = onStep(INITIAL_STATE, T0, USAGE)
const hour = onTranscript(stepped, { model: 'claude-opus-5-5', ttl: '1h', speed: 'standard', geo: 'global' })

test('defaultMinutesOf accepts whole minutes from 1 to 60', () => {
  expect(defaultMinutesOf({ default_cache_minutes: 60 })).toBe(60)
  expect(defaultMinutesOf({ default_cache_minutes: 1 })).toBe(1)
  for (const bad of [0, 61, 7.5, '60', undefined]) {
    expect(() => defaultMinutesOf({ default_cache_minutes: bad })).toThrow('default_cache_minutes')
  }
})

test('a main step anchors the clock and records what the next request re-sends', () => {
  expect(stepped).toEqual({ hasTurn: true, anchorAt: T0, model: 'claude-opus-5-5', basisTokens: 432_058 })
  expect(cacheView(stepped, T0 + 768_000, 60)).toEqual({ kind: 'warm', ttlLabel: '60m set', remainingMs: 2_832_000, isWarning: false })
})

test('a detected window replaces the setting; the warning starts 5 minutes before cold', () => {
  expect(cacheView(hour, T0 + 3_299_999, 60)).toEqual({ kind: 'warm', ttlLabel: '1h detected', remainingMs: 300_001, isWarning: false })
  expect(cacheView(hour, T0 + 3_300_000, 60)).toEqual({ kind: 'warm', ttlLabel: '1h detected', remainingMs: 300_000, isWarning: true })
  expect(cacheView(hour, T0 + 3_600_000, 60)).toEqual({ kind: 'cold', ttlLabel: '1h detected' })
})

test('a 5-minute window never warns', () => {
  const s = onTranscript(stepped, { model: 'claude-opus-5-5', ttl: '5m' })
  const view = cacheView(s, T0 + 1_000, 60)
  expect(view).toEqual({ kind: 'warm', ttlLabel: '5m detected', remainingMs: 299_000, isWarning: false })
  expect(shouldWarn(s, view)).toBe(false)
})

test('a transcript row without cache writes keeps the earlier window', () => {
  expect(onTranscript(hour, { model: 'claude-opus-5-5' }).ttl).toBe('1h')
})

test('warns once per anchor, and never once cold (a computer waking from sleep)', () => {
  const warning = cacheView(hour, T0 + 3_300_000, 60)
  expect(shouldWarn(hour, warning)).toBe(true)
  expect(shouldWarn(onWarned(hour), warning)).toBe(false)
  expect(shouldWarn(hour, cacheView(hour, T0 + 3_700_000, 60))).toBe(false)
})

test('clear and compact leave no cached conversation', () => {
  const s = onReset(hour)
  expect(cacheView(s, T0, 60)).toEqual({ kind: 'none', ttlLabel: '1h detected' })
  expect(s.hasTurn).toBe(false)
})

test('resume backdates the anchor by the time since the last reply', () => {
  const s = onResume(INITIAL_STATE, 10_000_000, { seconds_since_last_response: 600, context_tokens: 182_400, model: 'claude-opus-5-5' })
  expect(s).toEqual({ hasTurn: false, anchorAt: 9_400_000, basisTokens: 182_400, model: 'claude-opus-5-5' })
  const gapUnknown = onResume(INITIAL_STATE, 10_000_000, { context_tokens: 182_400 })
  expect(cacheView(gapUnknown, 10_000_000, 60).kind).toBe('cold')
})

test('a model switch starts the new model cold with Claude Code\'s own window', () => {
  const s = onModelSwitch(stepped, { to_model: 'claude-sonnet-5-5', cache_ttl: '1h', context_tokens: 182_400 })
  expect(s).toMatchObject({ model: 'claude-sonnet-5-5', ttl: '1h', basisTokens: 182_400, hasTurn: true })
  expect(s.anchorAt).toBeUndefined()
  expect(cacheView(s, T0, 60).kind).toBe('cold')
})

test('pricing uses the detected window, else 1h when the setting is over 5 minutes', () => {
  expect(pricingTtlOf(INITIAL_STATE, 60)).toBe('1h')
  expect(pricingTtlOf(INITIAL_STATE, 5)).toBe('5m')
  expect(pricingTtlOf({ hasTurn: false, ttl: '5m' }, 60)).toBe('5m')
})
```

- [ ] **Step 2: Run `claude plugin test`**

Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `hooks/cache-clock.ts`**

The transitions follow the spec's Cache clock table:

- `onStep` sets `anchorAt`, `model`, `basisTokens` (the sum of the four counts) and `hasTurn: true`.
- `onReset` clears `anchorAt`, `basisTokens` and `hasTurn`.
- `onResume` sets `anchorAt = now - seconds * 1000` (left unset when seconds is missing), `basisTokens = context_tokens`, `model = e.model ?? s.model` and `hasTurn: false`.
- `onModelSwitch` clears `anchorAt` and sets `model`, `ttl` and `basisTokens`.
- `onTranscript` takes `ttl`, `speed` and `geo` from the info when present, and keeps the old ones otherwise.
- `onWarned` sets `warnedFor = anchorAt`.

The reads:

- `ttlLabel`: `<ttl> detected` when detected, else `<defaultMinutes>m set`.
- `cacheView`: no `basisTokens` gives `none`. No `anchorAt` gives `cold`. Otherwise remaining = `anchorAt + ttlMsOf - now`, which is `cold` at 0 or below.
- `isWarning`: `ttlMsOf > WARN_MS` and remaining is at most `WARN_MS`.
- `shouldWarn`: the view is warm and warning, and `warnedFor !== anchorAt`.

- [ ] **Step 4: Checks pass, then commit**

Commit message: "Add the cache clock".

---

### Task 3: Pricing

**Files:**
- Create: `hooks/pricing.ts`
- Test: `tests/pricing.test.ts`

**Interfaces:**
- Consumes: `Ttl` from Task 2.
- Produces: `type PriceInput = { model: string; tokens: number; ttl: Ttl; speed?: string; geo?: string }` and `recacheUsd(input: PriceInput): number | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'claude-code/testing'
import { recacheUsd } from '../hooks/pricing.ts'

// Hundredths of a cent, so float noise can't fail a comparison
const units = (model: string, tokens: number, ttl: '5m' | '1h', extra: { speed?: string; geo?: string } = {}) => {
  const usd = recacheUsd({ model, tokens, ttl, ...extra })
  return usd === undefined ? undefined : Math.round(usd * 10_000)
}

test('Opus 5.5 at 182,400 tokens', () => {
  expect(units('claude-opus-5-5', 182_400, '1h')).toBe(14_592)
  expect(units('claude-opus-5-5', 182_400, '5m')).toBe(9_120)
  expect(units('claude-opus-5-5', 182_400, '1h', { speed: 'fast' })).toBe(29_184)
  expect(units('claude-opus-5-5', 182_400, '1h', { geo: 'us' })).toBe(16_051)
})

test('Haiku 5.5 uses its long-prompt price over 100,000 tokens', () => {
  expect(units('claude-haiku-5-5', 90_000, '1h')).toBe(180)
  expect(units('claude-haiku-5-5', 120_000, '1h')).toBe(1_200)
})

test('model ids match by family, with suffixes', () => {
  expect(units('claude-sonnet-5-5[1m]', 100_000, '1h')).toBe(4_000)
  expect(units('claude-opus-5-20260601', 100_000, '1h')).toBe(10_000)
  expect(units('claude-opus-4-1-20250805', 100_000, '1h')).toBe(30_000)
  expect(units('claude-fable-5-1', 100_000, '5m')).toBe(12_500)
})

test('an unknown model has no price', () => {
  expect(recacheUsd({ model: 'gpt-6', tokens: 100_000, ttl: '1h' })).toBeUndefined()
})
```

- [ ] **Step 2: Run `claude plugin test`**

Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `hooks/pricing.ts`**

Base input price per million tokens, by family:

| Family | Base input | Fast-mode input |
| --- | --- | --- |
| `fable-5-1`, `mythos-5-1` | 10 | |
| `opus-5-5` | 4 | 8 |
| `sonnet-5-5` | 2 | |
| `haiku-5-5` | 0.10, or 0.50 over 100,000 tokens | |
| `fable-5`, `mythos-5` | 10 | |
| `opus-5` | 5 | 10 |
| `opus-4-8` | 5 | 10 |
| `opus-4-7`, `opus-4-6`, `opus-4-5` | 5 | |
| `opus-4-1`, `opus-4` | 15 | |
| `sonnet-5` | 2 | |
| `sonnet-4-6`, `sonnet-4-5`, `sonnet-4` | 3 | |
| `haiku-4-5` | 1 | |

- Match the longest family whose `claude-<family>` occurs in the lowercased model id.
- Rate = base (the fast price when `speed` is `fast` and the family has one) × 2 for `1h` or 1.25 for `5m`, × 1.1 when `geo` is `us`.
- Result = tokens / 1,000,000 × rate.

- [ ] **Step 4: Checks pass, then commit**

Commit message: "Add re-cache pricing".

---

### Task 4: Transcript parsing

**Files:**
- Create: `hooks/transcript.ts`, `tests/fixtures.ts`
- Test: `tests/transcript.test.ts`

**Interfaces:**
- Consumes: `Ttl` and `TranscriptInfo` from Task 2.
- Produces:
  - `ttlFromUsage(usage: unknown): Ttl | undefined`
  - `lastMainUsage(output: string): TranscriptInfo | undefined`
  - Test helpers in `tests/fixtures.ts`: `assistantRow(o?: { model?: string; ttl5m?: number; ttl1h?: number; speed?: string; geo?: string; isSidechain?: boolean }): string`, `progressRow(): string` and `decodeCommand(base64: string): string`, the inverse of Task 5's `encodeCommand`.

- [ ] **Step 1: Write the fixtures and the failing test**

`assistantRow` writes one compact JSON line shaped like a real transcript row:

```text
{ parentUuid, isSidechain, message: { model, id, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, cache_creation: { ephemeral_1h_input_tokens, ephemeral_5m_input_tokens }, inference_geo, speed } }, type: 'assistant', uuid, timestamp }
```

Defaults: model `claude-opus-5-5`, no 5m writes, no 1h writes, speed `standard`, geo `global`, `isSidechain: false`.

`progressRow` writes `{ type: 'progress', isSidechain: false, data: { message: { type: 'assistant', message: { usage: { cache_creation: { ephemeral_1h_input_tokens: 9, ephemeral_5m_input_tokens: 0 } } } } } }`.

```ts
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
```

- [ ] **Step 2: Run `claude plugin test`**

Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `hooks/transcript.ts`**

Split on `\r?\n` and walk from the end. A line that fails `JSON.parse` is skipped. Accept the first row with `type === 'assistant'`, `isSidechain !== true`, a string `message.model` and an object `message.usage`. Narrow `unknown` with small guards; no `any`.

- [ ] **Step 4: Checks pass, then commit**

Commit message: "Parse the cache window from transcript rows".

---

### Task 5: PowerShell scripts

**Files:**
- Create: `hooks/powershell.ts`
- Test: `tests/powershell.test.ts`

**Interfaces:**
- Produces:
  - `const POWERSHELL = 'powershell.exe'`
  - `psQuote(text: string): string`
  - `encodeCommand(script: string): string`
  - `powershellArgv(script: string): string[]`
  - `tailScript(transcriptPath: string): string`
  - `toastScript(title: string, body: string): string`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run `claude plugin test`**

Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `hooks/powershell.ts`**

- `psQuote` wraps the text in `'` and doubles each of `'`, `‘`, `’`, `‚` and `‛`. PowerShell reads all of them as single quotes.
- `encodeCommand` turns each UTF-16 code unit into two bytes (low byte first), then base64s the result with `btoa`.
- `tailScript` is exactly the two lines in the test.
- `toastScript` is exactly these lines, with each `psQuote` result substituted:

```text
$ErrorActionPreference = 'Stop'
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$title = [System.Security.SecurityElement]::Escape(<psQuote(title)>)
$body = [System.Security.SecurityElement]::Escape(<psQuote(body)>)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template=""ToastGeneric""><text>$title</text><text>$body</text></binding></visual></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe').Show($toast)
```

- [ ] **Step 4: Run the tail script for real with pwsh**

Point it at a real transcript (`$T`):

```bash
pwsh -NoProfile -NonInteractive -EncodedCommand "$(node --experimental-strip-types -e "import('./hooks/powershell.ts').then(m => process.stdout.write(m.encodeCommand(m.tailScript(process.argv[1]))))" "$T")" > tail.txt
node --experimental-strip-types -e "import('./hooks/transcript.ts').then(m => console.log(JSON.stringify(m.lastMainUsage(require('node:fs').readFileSync(process.argv[1], 'utf8')))))" tail.txt
```

Expected: `{"model":"claude-opus-5-5","ttl":"1h","speed":"standard","geo":"global"}`.

- [ ] **Step 5: Parse-check the toast script with pwsh**

Run `[System.Management.Automation.Language.Parser]::ParseInput` on `toastScript('Cache Keeper: Brian’s app', 'Costs $1.46 & <soon>')`.

Expected: 0 parse errors.

- [ ] **Step 6: Checks pass, then commit**

Commit message: "Add the PowerShell tail and toast scripts".

---

### Task 6: Handoff text

**Files:**
- Create: `hooks/handoff.ts`
- Test: `tests/handoff.test.ts`

**Interfaces:**
- Produces:
  - `HANDOFF_PROMPT: string`
  - `projectName(cwd: string): string`
  - `handoffFileName(savedAt: number, project: string): string`
  - `handoffPath(userProfile: string, fileName: string): string`
  - `handoffFileText(i: { brief: string; project: string; savedAt: number; sessionId: string }): string`
  - `handoffDraft(path: string, brief: string): string`
  - `forkFailureText(r: { reason: string; status?: number | null }): string`
  - `stoppedText(message: string, savedPath?: string): string`
  - `fillRefusedText(path: string, refusal?: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'claude-code/testing'
import { HANDOFF_PROMPT, fillRefusedText, forkFailureText, handoffDraft, handoffFileName, handoffFileText, handoffPath, projectName, stoppedText } from '../hooks/handoff.ts'

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
  expect(forkFailureText({ reason: 'api-error', status: 529 })).toBe('Handoff & Clear stopped: the brief request failed (529).')
  expect(forkFailureText({ reason: 'api-error', status: null })).toBe('Handoff & Clear stopped: the brief request failed (no status).')
  expect(forkFailureText({ reason: 'empty-reply' })).toBe('Handoff & Clear stopped: the model returned no brief.')
  expect(forkFailureText({ reason: 'aborted' })).toBe('Handoff & Clear stopped: the brief request was cancelled.')
  expect(forkFailureText({ reason: 'nothing-to-fork' })).toBe('Handoff & Clear stopped: there is no conversation to hand off yet.')
  expect(stoppedText('USERPROFILE is not set')).toBe('Handoff & Clear stopped: USERPROFILE is not set.')
  expect(stoppedText('clear failed', 'C:\\h.md')).toBe('Handoff & Clear stopped: clear failed. The brief is saved at C:\\h.md.')
  expect(fillRefusedText('C:\\h.md', 'dialog')).toBe('Brief saved at C:\\h.md, but it could not be put in the prompt box (dialog).')
  expect(fillRefusedText('C:\\h.md')).toBe('Brief saved at C:\\h.md, but it could not be put in the prompt box (refused).')
})

test('the prompt asks for the six sections, text only', () => {
  for (const part of ['## Goal', '## Current state', '## Decisions and reasons', '## Open questions', '## Next steps', '## Key files and commands', 'Do not call tools.']) {
    expect(HANDOFF_PROMPT).toContain(part)
  }
})
```

- [ ] **Step 2: Run `claude plugin test`**

Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `hooks/handoff.ts`**

- Safe project name: replace each character outside `[A-Za-z0-9._-]` with `-`.
- Local-time fields come from `Date` getters, zero-padded.
- Brief text is trimmed in both the file and the draft.
- `HANDOFF_PROMPT` is exactly:

```text
Write a handoff brief so a fresh Claude Code session with no memory of this conversation can continue the work. Reply with the brief only, in Markdown, under 500 words, using these sections:

## Goal
## Current state
## Decisions and reasons
## Open questions
## Next steps
## Key files and commands

Be specific: exact file paths, commands, identifiers and values. Leave out finished work the next session does not need. Do not call tools. Do not use em dashes.
```

- [ ] **Step 4: Checks pass, then commit**

Commit message: "Add handoff brief text".

---

### Task 7: Band model and drawing

**Files:**
- Create: `hooks/band.ts`
- Test: `tests/band.test.ts`

**Interfaces:**
- Consumes: Task 2 (`CacheState`, `CacheView`, `cacheView`, `pricingTtlOf`), Task 3 (`recacheUsd`), Task 1 (formatters).
- Produces:
  - `type UsageSnapshot = { readonly context?: { readonly tokens?: number; readonly percent?: number }; readonly rateLimits: readonly { readonly kind: string; readonly percentUsed: number; readonly resetsAt?: string }[]; readonly cost?: { readonly usd: number } }`
  - `type Recache = { kind: 'usd'; usd: number } | { kind: 'unpriced'; model: string }`
  - `recacheOf(cache: CacheState, defaultMinutes: number): Recache | undefined`
  - `type BandModel = { view: CacheView; recache?: Recache; context?: { tokens: number; percent?: number }; fiveHour?: Limit; week?: Limit; costUsd?: number }`, where `Limit = { percentUsed: number; resetsInMs?: number }`
  - `bandModelOf(i: { cache: CacheState; usage?: UsageSnapshot; now: number; defaultMinutes: number }): BandModel`
  - `type Segment = { label: string; value: string; color?: 'success' | 'warning' | 'error'; note?: string }`
  - `segmentsOf(m: BandModel): Segment[]`
  - `type BandElements = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps>; Button: ElementConstructor<ButtonProps> }`
  - `bandTree(el: BandElements, m: BandModel): RenderElement`
  - `warningMessage(project: string, recache: Recache | undefined): { title: string; body: string }`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from 'claude-code/testing'
import type { CacheState } from '../hooks/cache-clock.ts'
import { bandModelOf, segmentsOf, warningMessage } from '../hooks/band.ts'

const T0 = 1_000_000
const NOW = T0 + 768_000
const cache: CacheState = { hasTurn: true, anchorAt: T0, ttl: '1h', model: 'claude-opus-5-5', basisTokens: 182_400 }
const usage = {
  context: { tokens: 182_400, percent: 18 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 34.2, resetsAt: new Date(NOW + 7_800_000).toISOString() },
    { kind: 'seven_day', percentUsed: 61, resetsAt: new Date(NOW + 273_600_000).toISOString() },
  ],
  cost: { usd: 12.84 },
}
const segs = (c: CacheState, now: number, defaultMinutes = 60, u: typeof usage | undefined = usage) =>
  segmentsOf(bandModelOf({ cache: c, usage: u, now, defaultMinutes }))

test('a warm cache reads like the approved mockup', () => {
  expect(segs(cache, NOW)).toEqual([
    { label: 'cache', value: '47:12', color: 'success', note: '1h detected' },
    { label: 'ctx', value: '182.4k 18%' },
    { label: '5h', value: '34% ↻2h10m' },
    { label: 'wk', value: '61% ↻3d4h' },
    { label: 'session', value: '$12.84' },
    { label: 'if cold', value: '$1.46' },
  ])
})

test('the last 5 minutes use the warning color', () => {
  expect(segs(cache, T0 + 3_300_000)[0]).toEqual({ label: 'cache', value: '5:00', color: 'warning', note: '1h detected' })
})

test('a cold cache shows what the next message costs', () => {
  const s = segs(cache, T0 + 3_600_000)
  expect(s[0]).toEqual({ label: 'cache', value: 'cold', color: 'error' })
  expect(s[5]).toEqual({ label: 'next msg', value: '$1.46' })
})

test('figures not reported yet show --', () => {
  expect(segs({ hasTurn: false }, T0, 45, undefined)).toEqual([
    { label: 'cache', value: '--:--', note: '45m set' },
    { label: 'ctx', value: '--' },
    { label: '5h', value: '--' },
    { label: 'wk', value: '--' },
    { label: 'session', value: '--' },
    { label: 'if cold', value: '--' },
  ])
})

test('an unknown model has no price', () => {
  expect(segs({ ...cache, model: 'gpt-6' }, NOW)[5]).toEqual({ label: 'if cold', value: 'no price for gpt-6' })
})

test('warningMessage names the project and the cost when it is known', () => {
  expect(warningMessage('bucket-dash', { kind: 'usd', usd: 1.4592 })).toEqual({
    title: 'Cache Keeper: bucket-dash',
    body: 'Prompt cache goes cold in 5 min. Re-caching after that costs $1.46. Send a message to keep it warm, or use Handoff & Clear.',
  })
  expect(warningMessage('x', { kind: 'unpriced', model: 'gpt-6' }).body)
    .toBe('Prompt cache goes cold in 5 min. Send a message to keep it warm, or use Handoff & Clear.')
})
```

- [ ] **Step 2: Run `claude plugin test`**

Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `hooks/band.ts`**

`recacheOf`:
- `undefined` without `basisTokens`.
- `{ kind: 'unpriced', model }` when `recacheUsd` gives nothing. Use `'unknown model'` when the state has no model.
- `{ kind: 'usd', usd }` otherwise, priced at `pricingTtlOf`, `speed` and `geo`.

Limits: `percentUsed` is rounded, and `↻<formatDuration>` is appended only when `resetsAt` is in the future.

`bandTree`:
- Root: `Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 })`.
- One `Box({ flexDirection: 'row', columnGap: 1 })` per segment, holding `Text dimColor` for the label, `Text` for the value (with `color` only when set) and `Text dimColor` for the note (only when set).

- [ ] **Step 4: Checks pass, then commit**

Commit message: "Add the band model and drawing".

---

### Task 8: Wire the band, cache clock and 5-minute warning

**Files:**
- Modify: `hooks/register.ts`
- Create: `tests/world.ts`
- Test: `tests/register.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 7.
- Produces, as module state in `register.ts`: `cache: CacheState`, `usage: UsageSnapshot | undefined` and `transcriptErrorShown: boolean`.
- Produces, as top-level functions:
  - `tick($: EngineInterface, defaultMinutes: number): Promise<void>`
  - `readCacheWindow($: EngineInterface, transcriptPath: string): Promise<void>`
  - `showWindowsToast($: EngineInterface, title: string, body: string): Promise<void>`
- Produces for tests: `tests/world.ts` exports `T0`, `CWD`, `SESSION`, `BAND_PROPS`, `world(on, opts?)`, `runStep($, agentId?)` and `mountBand($, surface?, props?)`.

**Hooks (`defaultMinutes = defaultMinutesOf(options)`):**

| Event | Does |
| --- | --- |
| `session.start` | `usage = await $.session.usage()`, then `$.clock.every(1000, () => tick($, defaultMinutes))`, then `next(e)`. |
| `session.measure` | `usage = e`, then invalidate. |
| `turn.step` (async generator) | For main steps only: `sentAt = await $.clock.now()` before `yield* next(e)`. On a result with `usage`: `cache = onStep(...)`, then invalidate. Return the result unchanged. |
| `classic.Stop` | `void readCacheWindow($, e.transcript_path)`, then `next(e)`. |
| `classic.SessionStart` | Source `clear` or `compact`: `onReset`. Source `resume` or `fork`: `onResume`, then `void readCacheWindow(...)`. For all four, refresh `usage`, then invalidate. Source `startup`: nothing. |
| `classic.PostModelSwitch` | `onModelSwitch`, then invalidate. |
| `ui.render` `{ component: 'AbovePrompt' }` | With `e.props.hasSurvey`: `next(e)`. Otherwise `bandTree($.ui.resolve(e), bandModelOf({ cache, usage, now: await $.clock.now(), defaultMinutes }))`. |

**The three functions:**

- `tick`:
  1. Compute the view.
  2. If `shouldWarn`: `cache = onWarned(cache)`, then `void showWindowsToast($, ...warningMessage(projectName(await $.session.cwd()), recacheOf(cache, defaultMinutes)))`.
  3. Invalidate.
- `readCacheWindow`: `$.process.run(powershellArgv(tailScript(path)), { timeoutMs: 15000 })`.
  - Exit 0: `info = lastMainUsage(stdout)`. When there is info, `cache = onTranscript(cache, info)`, then invalidate.
  - Otherwise (a non-zero exit or a rejection): the first time only, `$.ui.toast('Cache Keeper could not read the cache window: ' + detail, { timeoutMs: 10000 })`.
- `showWindowsToast`: the same `$.process.run` shape with `toastScript(title, body)`. On failure: `$.ui.toast('Cache Keeper could not show a Windows notification: ' + detail, { timeoutMs: 10000 })`.

`detail` is `stderr.trim()`, else `exit code N`, or the rejection's message.

- [ ] **Step 1: Write `tests/world.ts`**

`world(on, opts?)` registers every stub the mod needs before the first `$` call, and returns `{ clock, toasts, scripts, tail, toast }`:

- `clock`: `mock.clock(on, { now: T0 })`, with `T0 = 1_000_000`.
- `session.start`: `({ cwd: e.cwd })`.
- `session.usage`: `{ value: { context: { window: 1_000_000 }, rateLimits: [], cost: { usd: 0 } } }`.
- `session.cwd`: `{ value: CWD }`, with `CWD = 'C:\\work\\bucket-dash'`.
- `session.measure`: `({ changed: e.changed })`.
- `ui.toast`: pushes `e.text` to `toasts`.
- `process.run`: decodes `e.argv[4]` with `decodeCommand` and pushes the script to `scripts`.
  - A script containing `Get-Content` answers `{ value: { exitCode: tail.exitCode, stdout: tail.output, stderr: tail.stderr, isStdoutTruncated: false, isStderrTruncated: false } }`.
  - Any other script answers the same shape from `toast.exitCode` and `toast.stderr`.
  - Defaults are exit 0 with empty output.
- `turn.step`: an async generator returning `{ turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { input_tokens: 2, output_tokens: 3_651, cache_read_input_tokens: 425_512, cache_creation_input_tokens: 2_893, model: 'claude-opus-5-5' } }`.
- `classic.Stop`, `classic.SessionStart`, `classic.PostModelSwitch`: each answers `({})`.

`runStep` raises `$.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId })` and drains the stream.

`mountBand` mounts `AbovePrompt` for plugin `cache-keeper` with these default props: `BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 115, scroll: { offset: 0, bodyRows: 8 }, view: {} }`.

- [ ] **Step 2: Write the failing tests in `tests/register.test.ts`**

Each test calls `await $.session.start(SESSION)` first. `RESUME` is `{ source: 'resume', model: 'claude-opus-5-5', context_tokens: 182_400, transcript_path: 'C:\\t.jsonl' }`.

| Test | Arrange and act | Assert |
| --- | --- | --- |
| a main step starts the countdown, on terminal and desktop | `runStep($)`, then mount on each surface, then `clock.advance(2_000)` | Text `60:00` and `60m set` are found, then `59:58` |
| subagent steps leave the clock alone | `runStep($, 'agent-1')` | Text `--:--` is found |
| Stop reads the cache window from the transcript tail | `tail.output = assistantRow({ ttl5m: 700 })`, then `$.classic.Stop({ stop_hook_active: false, transcript_path: 'C:\\t.jsonl' })`, then `clock.settle()` | Text `5m detected` is found. `scripts[0]` contains `-LiteralPath 'C:\t.jsonl'` |
| a failed tail read toasts once per session | `tail = { output: '', exitCode: 1, stderr: 'boom' }`, then two Stops and a settle | `toasts` equals `['Cache Keeper could not read the cache window: boom']` |
| warns once, 5 minutes before cold | `$.classic.SessionStart({ ...RESUME, seconds_since_last_response: 3_290 })`, then `clock.advance(10_000)`, then `clock.advance(60_000)` | Exactly one script contains `ToastNotificationManager`, `Cache Keeper: bucket-dash` and `Re-caching after that costs $1.46` |
| a 5-minute window never warns | `tail.output = assistantRow({ ttl5m: 700 })`, then resume with `seconds_since_last_response: 5`, then `clock.settle()`. Text `5m detected` must be found before going on (the countdown is already under 5:00). Then `clock.advance(10_000)` | No script contains `ToastNotificationManager` |
| a failed Windows toast shows an in-app toast | `toast = { exitCode: 1, stderr: 'no WinRT' }`, then the warning arrangement | `toasts` equals `['Cache Keeper could not show a Windows notification: no WinRT']` |
| a model switch shows cold with the new model's price | `runStep`, then `$.classic.PostModelSwitch({ from_model: 'claude-opus-5-5', to_model: 'claude-sonnet-5-5', requested_model: 'sonnet', source: 'command', context_tokens: 182_400, prompt_cache_warm: true, cache_ttl: '1h', estimated_cache_write_usd: 0.73, pricing: 'catalog' })` | Text `cold`, `next msg` and `$0.73` are found |
| clear resets to --:-- | `runStep`, then `$.classic.SessionStart({ source: 'clear' })` | Text `--:--` is found |
| usage figures follow session.measure | `$.session.measure({ context: { tokens: 50_000, window: 1_000_000, percent: 5 }, rateLimits: [{ kind: 'five_hour', percentUsed: 12 }], cost: { usd: 3.2 }, changed: ['cost'] })` | Text `50k 5%`, `12%` and `$3.20` are found |
| the band yields to a survey | Stub `ui.render` with `() => ({ type: 'Text', props: {}, children: ['survey'] })`, then mount with `hasSurvey: true` | Text `survey` is found and `--:--` is not |

The last test registers its own `ui.render` stub before `world` runs.

- [ ] **Step 3: Run `claude plugin test`**

Expected: FAIL, because `register.ts` is still empty.

- [ ] **Step 4: Implement `hooks/register.ts`**

Follow the two tables above.

- [ ] **Step 5: Checks pass, now with `claude plugin validate --strict .`, then commit**

Commit message: "Wire the band, cache clock and 5-minute warning".

---

### Task 9: Handoff & Clear

**Files:**
- Modify: `hooks/band.ts`, `hooks/register.ts`, `tests/world.ts`, `tests/band.test.ts`
- Test: `tests/handoff-flow.test.ts`

**Interfaces:**
- Consumes: Task 6 (all exports), Task 7 (`bandModelOf`, `bandTree`), Task 8 (`world`, `mountBand`, `runStep`).
- Changes `band.ts`:
  - `BandModel` gains `button: 'hidden' | 'ready' | 'writing'`.
  - The `bandModelOf` input gains `isWorking: boolean` and `handoffRunning: boolean`.
  - `bandTree(el, m, onHandoff: () => Promise<void>)`.
- Produces in `register.ts`: module state `handoffRunning: boolean` and `handoffAndClear($: EngineInterface): Promise<void>`.
- Changes `world(on, opts)`, which gains:
  - `opts.userProfile: string | null`, default `'C:\\Users\\Brian'`, set through `mock.env`.
  - Stubs: `model.fork` answers `{ value: w.forkResult }`, default `{ isAnswered: true, text: '## Goal\nShip it.', usage }` with zero usage counts. `fs.write` records `{ path, text }`, answering `{ deny: 'disk full' }` when `opts.writeFails`. `session.id` answers `'abc123'`. `command.run` records the command and throws when `opts.clearFails`. `prompt.fill` records `e.text` and answers `w.fillResult`, default `{ isFilled: true }`.
  - Every stub appends its step name to `w.calls`: `fork`, `write`, `clear` or `fill`.

- [ ] **Step 1: Write the failing tests**

New cases in `tests/band.test.ts`:

- `button` is `ready` after a turn when idle.
- `button` is `hidden` with `isWorking`, and also before any turn.
- `button` is `writing` with `handoffRunning`.

The new `tests/handoff-flow.test.ts` (`PATH` = `handoffPath('C:\\Users\\Brian', handoffFileName(T0, 'bucket-dash'))`):

| Test | Arrange and act | Assert |
| --- | --- | --- |
| the button appears after a main turn and hides while working | Mount before and after `runStep`, then mount with `isWorking: true` | Key `handoff` is absent, then present with label `Handoff & Clear`, then absent |
| Handoff & Clear forks, saves, clears, then drafts the brief | `runStep`, then mount, then press `handoff` | `calls` equals `['fork', 'write', 'clear', 'fill']`. The written path equals `PATH`, and its text starts with `# Handoff brief: bucket-dash`. The filled text equals `handoffDraft(PATH, '## Goal\nShip it.')` |
| a failed brief stops before saving or clearing | `forkResult = { isAnswered: false, reason: 'api-error', status: 529, error: { type: 'overloaded_error', message: 'x' }, usage }` | `calls` equals `['fork']`. `toasts` equals `['Handoff & Clear stopped: the brief request failed (529).']` |
| a refused save never clears | `writeFails` | `calls` equals `['fork', 'write']`. `toasts[0]` starts with `Handoff & Clear stopped:` |
| an unset USERPROFILE stops before saving | `userProfile: null` | `calls` equals `['fork']`. `toasts` equals `['Handoff & Clear stopped: USERPROFILE is not set.']` |
| a failed clear names the saved brief | `clearFails` | `toasts[0]` ends with `The brief is saved at ` + `PATH` + `.` |
| a refused fill names the saved brief | `fillResult = { isFilled: false, refusal: 'dialog' }` | `toasts` equals `[fillRefusedText(PATH, 'dialog')]` |
| the band shows progress and takes no second press while writing | The fork stub awaits `clock.sleep(5_000)`. Then `const pressing = ui.press({ key: 'handoff' })` and `clock.settle()` | Key `handoff` is absent and Text `writing handoff brief...` is present. After `clock.advance(5_000)` and `await pressing`, `calls` has one `fork` and the writing text is gone |

- [ ] **Step 2: Run `claude plugin test`**

Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`band.ts`:
- `button` is `writing` when `handoffRunning`. It is `hidden` when `isWorking` or `!cache.hasTurn`. Otherwise it is `ready`.
- `bandTree` appends `Button({ key: 'handoff', label: 'Handoff & Clear', hotkey: 'h', plain: true, onPress: () => onHandoff() })` when `ready`, and `Text({ dimColor: true, children: ['writing handoff brief...'] })` when `writing`.

`register.ts`: the render hook passes `isWorking: e.props.isWorking`, `handoffRunning` and `onHandoff: () => handoffAndClear($)`.

`handoffAndClear`:
1. Return at once if `handoffRunning`. Otherwise set it and invalidate.
2. `$.model.fork({ prompt: HANDOFF_PROMPT })`. When not answered: toast `forkFailureText(reply)` and stop.
3. `$.env.get("USERPROFILE")`. When unset: throw `Error('USERPROFILE is not set')`.
4. Build the path with `handoffPath` and `handoffFileName($.clock.now(), projectName($.session.cwd()))`, then `$.fs.write(path, handoffFileText({ ..., sessionId: await $.session.id() }))`, and remember `savedPath`.
5. `$.command.run({ command: 'clear' })`.
6. `$.prompt.fill({ text: handoffDraft(path, brief) })`. When not filled: toast `fillRefusedText(path, refusal)`.
7. Any thrown error: toast `stoppedText(message, savedPath)`.
8. `finally`: `handoffRunning = false`, then invalidate.

Every toast here uses `{ timeoutMs: 10000 }`.

- [ ] **Step 4: Checks pass, then commit**

Commit message: "Add Handoff & Clear".

---

### Task 10: README, marketplace and install check

**Files:**
- Create: `README.md`, `.claude-plugin/marketplace.json`

- [ ] **Step 1: Add `.claude-plugin/marketplace.json`**

Name `cache-keeper`, owner Brian Boyer, a description (`claude plugin validate --strict` requires one), and one plugin entry `{ "name": "cache-keeper", "source": "./" }`.

- [ ] **Step 2: Write `README.md`**

Sections:
- What the strip shows, with one example line and what each segment means.
- Requirements: Claude Code 2.1.302 or later, Windows, the terminal or the Desktop Code tab.
- Install: `claude plugin marketplace add <folder>`, then `claude plugin install cache-keeper@cache-keeper --config default_cache_minutes=60`.
- The setting.
- Where each number comes from, with the pricing source and date.
- Handoff & Clear, including where briefs are saved and `claude --resume`.
- Limits: subagents; resets not tracked; the VS Code panel and cloud sessions.
- Uninstall.

No em dashes.

- [ ] **Step 3: Checks pass, then a scratch install**

With `HOME` pointed at an empty scratch folder, run `claude plugin marketplace add .` and then `claude plugin install cache-keeper@cache-keeper --config default_cache_minutes=60`.

Expected: both succeed, and `claude plugin list` shows `cache-keeper@cache-keeper` enabled.

- [ ] **Step 4: Commit**

Commit message: "Add README and local marketplace".

---

### Task 11: Install on Brian's PC and check it live

This is done with Brian, on his Windows PC. Each check is something visible on screen.

- [ ] **Step 1: Put the repo on his PC and install it**

Copy the repo to a folder on his PC, either through a connected folder or as a zip. Brian then runs the two install commands from Task 10.

- [ ] **Step 2: Check the toast path**

In PowerShell, run `powershell.exe -NoProfile -NonInteractive -EncodedCommand <code>`, where `<code>` is `encodeCommand(toastScript('Cache Keeper: test', 'If you can read this, toasts work.'))` generated in the dev container.

Expected: a Windows toast titled `Cache Keeper: test`.

- [ ] **Step 3: Check the strip in the terminal**

Start `claude` in a project and send one message.

Expected: the strip shows `cache 59:xx 1h detected`, ctx, 5h, wk, session and if cold, and the countdown ticks.

- [ ] **Step 4: Check the Desktop app**

Open the same project in the Desktop app's Code tab.

Expected: the same strip, and the button is clickable.

- [ ] **Step 5: Check Handoff & Clear**

Press Handoff & Clear.

Expected: a brief file appears under `%USERPROFILE%\.claude\cache-keeper\handoffs`, the session clears, and the brief sits in the prompt box.
