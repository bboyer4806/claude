# Cache Keeper: design

Date: 2026-10-18. Status: design approved in chat; this spec is for review.

## Goal

A Claude Code mod that keeps the prompt cache and session cost in view above the prompt, warns before the cache goes cold, and offers a one-press Handoff & Clear.

Target: Claude Code 2.1.302 on Windows, in the terminal CLI and the Desktop app's Code tab.

## Scope

In scope:

- The strip above the prompt (the mods `AbovePrompt` band).
- A Windows toast 5 minutes before the cache goes cold.
- The Handoff & Clear button.
- One setting: the default cache window.

Out of scope:

- Subagent caches.
- Cache resets other than a model switch, `/clear` and `/compact` (effort changes, fast mode toggles, MCP or plugin changes). `/usage` reports those.
- The VS Code chat panel and cloud sessions, where mods draw nothing.
- Notifications on macOS and Linux.

## The band

One row of segments, wrapping when the window is narrow. When a survey holds the band, the mod yields to it.

| Segment | Example | Source |
| --- | --- | --- |
| cache | `cache 47:12 1h detected`, `cache --:-- 60m set`, `cache cold` | Cache clock, below |
| ctx | `ctx 182.4k 18%` | `$.session.usage().context`: `tokens`, `percent` |
| 5h | `5h 34% ↻2h10m` | `rateLimits` entry `five_hour`: `percentUsed`, `resetsAt` |
| wk | `wk 61% ↻3d4h` | `rateLimits` entry `seven_day` |
| session | `session $12.84` | `$.session.usage().cost.usd`, the `/cost` total at API list prices |
| re-cache | `if cold $1.46` while warm, `next msg $1.46` when cold | Re-cache cost, below |
| button | `h: Handoff & Clear` | Shown only after a main turn has run since the last clear, compact, resume or fork, and hidden while a turn runs or a handoff is in progress |

- A figure Claude Code has not reported yet shows `--`.
- Countdown color: `success` while warm, `warning` in the last 5 minutes (only when the window is longer than 5 minutes), `error` when cold.
- Usage figures refresh at `session.start`, on `session.measure`, and after `/clear`, `/compact`, `/resume` and `/branch`. The band redraws once a second.

## Cache clock

This mirrors the "Prompt cache (main)" line in Claude Code's `/usage`, as implemented in the 2.1.302 binary: the cache expires one TTL after the last main-conversation request was sent, and the TTL is read from that request's response.

State kept in the module: `anchorAt` (ms), `ttl` (`5m`, `1h` or unknown), `basisTokens`, `model`, `speed`, `geo`, `hasTurn`, `warnedFor`.

| Event | Effect |
| --- | --- |
| `turn.step`, main thread only (no `agentId`) | Take the time before sending. On a response with usage: `anchorAt` = that time, `model` = `usage.model`, `basisTokens` = input + cache read + cache creation + output tokens (Claude Code's own `context_tokens`), `hasTurn` = true. |
| `classic.Stop` | Read the transcript tail. From the last main assistant row's `message.usage`: `ttl` = `5m` if `cache_creation.ephemeral_5m_input_tokens` > 0, else `1h` if `ephemeral_1h_input_tokens` > 0, else unchanged; `speed` = `usage.speed`; `geo` = `usage.inference_geo`. |
| `classic.SessionStart`, source `clear` or `compact` | Clear `anchorAt`, `basisTokens` and `hasTurn`: there is no cached conversation yet. |
| `classic.SessionStart`, source `resume` or `fork` | `anchorAt` = now minus `seconds_since_last_response`, `basisTokens` = `context_tokens`, `model` = `e.model`, `hasTurn` = false. Then read the transcript tail as on Stop. |
| `classic.PostModelSwitch` | Clear `anchorAt` (the new model starts cold). `model` = `to_model`, `ttl` = `cache_ttl`, `basisTokens` = `context_tokens`. |

Display rules:

- No `basisTokens`: `--:--`.
- `basisTokens` but no `anchorAt`: cold.
- Otherwise remaining = `anchorAt` + TTL in effect - now, and cold at 0 or below.
- TTL in effect: the detected `ttl`, else the setting (labelled `60m set`).

Transcript tail: `powershell.exe -NoProfile -NonInteractive -EncodedCommand <script>`. The script runs `Get-Content -LiteralPath <transcript_path> -Tail 200 -Encoding UTF8`, keeps lines containing `"cache_creation":{`, and writes the last 3 as UTF-8. The mod parses them from the end and takes the first row whose `type` is `assistant` and whose `isSidechain` is not true.

This uses PowerShell rather than `$.fs.read` because `$.fs.read` stops at 4 MiB, and long transcripts pass that. A failed read shows one toast per session and leaves the TTL unchanged.

## Re-cache cost

Cost = `basisTokens` × write rate. It excludes the response, the same definition as Claude Code's own `estimated_cache_write_usd`.

Write rate per million tokens:

- Base input price × 2 for `1h`, × 1.25 for `5m`.
- × 1.1 when `geo` is `us`.
- When `speed` is `fast`, the base is the fast-mode input price: Opus 5.5 $8, Opus 5 and Opus 4.8 $10.
- Haiku 5.5 uses its over-100k prices when `basisTokens` is over 100,000.
- When the TTL is not detected, the 1h rate applies if the setting is over 5 minutes, else the 5m rate.

Prices come from the platform.claude.com pricing page as of 2026-10-18 and live in `hooks/pricing.ts`. Model ids are matched by family (`claude-opus-5-5`, with any suffix). An unknown model shows `no price for <model>`.

## 5-minute warning

In the one-second tick, the warning fires when all of these hold:

- The cache is warm.
- The TTL in effect is over 5 minutes.
- Remaining time is 5:00 or less.
- `warnedFor` differs from `anchorAt`.

It then sets `warnedFor` and shows a Windows toast through `powershell.exe` (WinRT `ToastNotificationManager`, under PowerShell's app id).

- Title: `Cache Keeper: <project folder>`.
- Body: `Prompt cache goes cold in 5 min. Re-caching after that costs $1.46. Send a message to keep it warm, or use Handoff & Clear.`
- A failed toast shows an in-app toast with the error.

`$.ui.notify` is not used: on Windows it can only ring the terminal bell, and in the Desktop app it does nothing.

## Handoff & Clear

The button can be pressed with hotkey `h` while the band has focus (Ctrl+X Tab), or clicked in the Desktop app or a fullscreen terminal.

1. The band shows `writing handoff brief...`, and further presses are ignored.
2. `$.model.fork({ prompt })` writes the brief over the session's own conversation, served from the cache while warm. The prompt asks for Markdown under 500 words with these sections: Goal, Current state, Decisions and reasons, Open questions, Next steps, Key files and commands. Text only, no em dashes.
3. Save the brief to `%USERPROFILE%\.claude\cache-keeper\handoffs\YYYY-MM-DD_HHmm_<project>.md`, with a header naming the project, the time, and `claude --resume <session id>`.
4. `$.command.run({ command: 'clear' })`.
5. `$.prompt.fill` replaces the prompt draft with `Continue from this handoff brief (saved at <path>):` followed by the brief. Brian adds an instruction and presses Enter.

Any failure stops the sequence and shows a toast with the reason, plus the file path once the brief is saved. The session is never cleared without a saved brief.

## Setting

`userConfig.default_cache_minutes`: a number from 1 to 60, default 60, shown in `/config` as "Default cache window (minutes)". It applies only until a TTL is detected.

## Files

| File | Responsibility |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest and `userConfig` |
| `hooks/hooks.json` | Points to the hooks module |
| `hooks/register.ts` | Event wiring and every `$` call |
| `hooks/cache-clock.ts` | Cache state, TTL from usage, the display state |
| `hooks/pricing.ts` | Price table and re-cache cost |
| `hooks/transcript.ts` | Picking the last main assistant row from tail output |
| `hooks/powershell.ts` | Encoding and quoting for `-EncodedCommand`, the tail and toast scripts |
| `hooks/handoff.ts` | Brief prompt, file name, file header, prompt draft |
| `hooks/band.ts` | The band's element tree |
| `hooks/format.ts` | Tokens, money, countdown and duration text |
| `tests/*.test.ts` | Tests run by `claude plugin test` |
| `README.md` | What it shows, install, the setting, limits |

## Testing

- `claude plugin validate --strict` and `tsc --noEmit` against the 2.1.302 declarations.
- `claude plugin test`:
  - Unit tests for every pure module.
  - Kit tests: the band in each state; the countdown and colors across a mock clock; the toast firing once per window and never for 5m windows; model switch, clear, resume; Handoff & Clear success and each failure path.
- PowerShell: the tail script run with pwsh 7 against a real transcript, and the toast script parse-checked with pwsh.
- On Brian's Windows PC: a live check of the band, a real toast, and one Handoff & Clear.

## Install

Install from a local marketplace folder on Brian's PC with `claude plugin marketplace add <folder>` and `claude plugin install cache-keeper@<marketplace>`. The mod then loads in the CLI and the Desktop Code tab.
