# Cache Keeper

A Claude Code mod that keeps the prompt cache in view. It draws one line above the prompt box, warns you 5 minutes before the cache goes cold, and offers a one-press Handoff & Clear.

```
cache 47:12 1h detected  ctx 182.4k 18%  5h 34% ↻2h10m  wk 61% ↻3d4h  session $12.84  if cold $1.46  h: Handoff & Clear
```

## What the strip shows

| Segment | Meaning |
| --- | --- |
| `cache 47:12 1h detected` | Time left before the prompt cache goes cold. `1h detected` means Claude Code reported the cache window; `60m set` means the setting is in use until it does. Green while warm, yellow in the last 5 minutes (for windows longer than 5 minutes), and `cold` in red once it has expired. Before the first reply it shows `--:--`. |
| `ctx 182.4k 18%` | Current context size in tokens, and the share of the model's context window it fills. |
| `5h 34% ↻2h10m` | Your 5-hour usage limit: percent used, and the time until it resets. |
| `wk 61% ↻3d4h` | Your weekly usage limit, the same way. |
| `session $12.84` | What this session would have cost on API billing, at list prices. |
| `if cold $1.46` | What rebuilding the cache would cost if it expired. Once it has, the label reads `next msg`: what your next message pays to rebuild it. |
| `h: Handoff & Clear` | The Handoff & Clear button, described below. |

A figure Claude Code has not reported yet shows `--`. The strip redraws every second and wraps when the window is narrow.

### The 5-minute warning

Five minutes before the cache goes cold, Windows shows a notification titled `Cache Keeper: <project folder>`:

> Prompt cache goes cold in 5 min. Re-caching after that costs $1.46. Send a message to keep it warm, or use Handoff & Clear.

It reaches you in any app, and fires once per cache window, only for windows longer than 5 minutes. A computer that sleeps past the window gets no late warning once the cache is cold.

The notification comes from Windows PowerShell, so Windows must allow notifications from Windows PowerShell (Settings, System, Notifications). Do not disturb holds it in the notification center. If the notification fails, Claude Code shows the error inside the app.

## Requirements

- Claude Code 2.1.302 or later (`claude --version`).
- Windows 10 or 11. The mod uses the built-in Windows PowerShell for the notification and to read the cache window.
- The terminal CLI or the Code tab of the Claude Desktop app.
- A Pro or Max plan. The `5h` and `wk` figures are that plan's usage limits.

## Install

1. Put the `cache-keeper` folder somewhere permanent, such as `C:\Users\<you>\claude-mods\cache-keeper`. Claude Code reads the mod from this folder, so moving or deleting it breaks the mod.
2. Open a terminal in the folder that contains `cache-keeper` and run:

   ```
   claude plugin marketplace add ./cache-keeper
   claude plugin install cache-keeper@cache-keeper --config default_cache_minutes=60
   ```

3. Restart Claude Code: end the terminal session or quit the Desktop app, then start it again.

`claude plugin list` shows `cache-keeper@cache-keeper` as enabled.

## The setting

`default_cache_minutes`, shown as "Default cache window (minutes)": the window the countdown uses until Claude Code reports the real one after a reply. Any number from 1 to 60; the default is 60. Until the window is known, it also picks the price for `if cold`: the 1-hour cache price when the setting is over 5 minutes, else the 5-minute price.

To change it, run `/plugin configure cache-keeper@cache-keeper` in Claude Code, then restart Claude Code.

## Where the numbers come from

- **cache**: the same rule as the "Prompt cache (main)" line in `/usage`. The cache goes cold one cache window after the last request of the main conversation was sent. After each reply, the mod reads the end of the session transcript through PowerShell to learn the window (5 minutes or 1 hour) from what that reply wrote to the cache. A model switch starts the cache cold, and `/clear` and `/compact` empty it.
- **ctx, 5h, wk, session**: Claude Code's own session usage figures. `session` is the total `/cost` reports, at API list prices.
- **if cold, next msg**: the conversation's size after the last reply, times the model's cache write price. That price is the base input price × 2 for a 1-hour window or × 1.25 for a 5-minute window, × 1.1 for US-only inference, with fast mode prices when fast mode answered, and Haiku 5.5's long-context price above 100,000 tokens. It leaves out your new message and the reply. Prices come from the [Claude pricing page](https://platform.claude.com/docs/en/about-claude/pricing) as of 2026-10-18 and live in `hooks/pricing.ts`. A model missing from that table shows `no price for <model>`.

## Handoff & Clear

The button appears once Claude has replied since the session started, or since the last `/clear`, `/compact` or resume, and hides while Claude is working. In the terminal, press Ctrl+X then Tab to move the focus to the strip, then `h`. In the Desktop app or a fullscreen terminal, you can click it.

One press:

1. Asks Claude for a handoff brief of this conversation: goal, current state, decisions and reasons, open questions, next steps, key files and commands. The strip shows `writing handoff brief...` meanwhile. The brief is one more request over the whole conversation, so it is cheapest while the cache is warm.
2. Saves it to `%USERPROFILE%\.claude\cache-keeper\handoffs\YYYY-MM-DD_HHmm_<project>.md`. The file's header includes `claude --resume <session id>`, which reopens the old session if you need it.
3. Runs `/clear`.
4. Puts the brief in the fresh session's prompt box, after "Continue from this handoff brief (saved at <path>):". Nothing is sent until you press Enter, so you can add instructions first.

If a step fails, the sequence stops and Claude Code shows why. The session is never cleared without a saved brief, and once the brief is saved, the message names its file.

## Limits

- Only the main conversation's cache is tracked. Subagents keep their own caches.
- Cache resets other than a model switch, `/clear` and `/compact` are not tracked: changing effort, turning fast mode on or off, and MCP server or plugin changes. After those, the countdown can show warm while the cache is cold; `/usage` shows the real state.
- Nothing is drawn in the VS Code chat panel or in cloud sessions, where mods do not draw.
- On a Team or Enterprise account, or a computer where an organization manages Claude Code, Claude Code skips three of the mod's hooks for mods you install yourself: the ones for a finished reply, a session start and a model switch. There, the countdown always uses the setting, and `/clear`, resume and model switches show only after your next message.

## Uninstall

```
claude plugin uninstall cache-keeper@cache-keeper
claude plugin marketplace remove cache-keeper
```

Then delete the `cache-keeper` folder. Saved briefs stay in `%USERPROFILE%\.claude\cache-keeper\handoffs` until you delete them.
