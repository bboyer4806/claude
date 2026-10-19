# Cache Keeper

A Claude Code mod that keeps the prompt cache in view. It draws one line above the prompt box, warns you 5 minutes before the cache goes cold, warns you when the conversation grows past your handoff threshold, and offers a one-press New session with handoff. With automatic handoff on, it hands off by itself when you are away.

```
cache 47:12 1h detected  ctx 182.4k 18%  5h 34% ↻2h10m  wk 61% ↻3d4h  session $12.84  if cold $1.46  h: New session with handoff
```

Past the threshold, `ctx` turns yellow and the Fresh session button joins the strip:

```
cache 47:12 1h detected  ctx 520k 52% quality may slip  ...  if cold $4.16  h: New session with handoff  f: Fresh session
```

## What the strip shows

| Segment | Meaning |
| --- | --- |
| `cache 47:12 1h detected` | Time left before the prompt cache goes cold. `1h detected` means Claude Code reported the cache window; `60m set` means the setting is in use until it does. Green while warm, yellow in the last 5 minutes (for windows longer than 5 minutes), and `cold` in red once it has expired. Before the first reply it shows `--:--`. |
| `ctx 182.4k 18%` | Current context size in tokens, and the share of the model's context window it fills. Yellow, with `quality may slip`, once it reaches your handoff threshold. |
| `5h 34% ↻2h10m` | Your 5-hour usage limit: percent used, and the time until it resets. |
| `wk 61% ↻3d4h` | Your weekly usage limit, the same way. |
| `session $12.84` | What this session would have cost on API billing, at list prices. |
| `if cold $1.46` | What rebuilding the cache would cost if it expired. Once it has, the label reads `next msg`: what your next message pays to rebuild it. |
| `h: New session with handoff` | The New session with handoff button, described below. |
| `f: Fresh session` | The Fresh session button, shown only past the threshold, described below. |

A figure Claude Code has not reported yet shows `--`. The strip redraws every second and wraps when the window is narrow. Another mod that draws in the same band, such as Assumption Tracker, keeps its line there, under or over Cache Keeper's.

The buttons appear once Claude has replied since the session started, or since the last `/clear`, `/compact` or resume, and hide while Claude is working. In the terminal, press Ctrl+X then Tab to move the focus to the strip, then the button's letter. In the Desktop app or a fullscreen terminal, you can click them.

### The 5-minute warning

Five minutes before the cache goes cold, Windows shows a notification titled `Cache Keeper: <project folder>`:

> Prompt cache goes cold in 5 min. Re-caching after that costs $1.46. Send a message to keep it warm, or use New session with handoff.

It reaches you in any app, and fires once per cache window, only for windows longer than 5 minutes. A computer that sleeps past the window gets no late warning once the cache is cold. With automatic handoff on, a handoff can take the warning's place; see below.

The notification comes from Windows PowerShell, so Windows must allow notifications from Windows PowerShell (Settings, System, Notifications). Do not disturb holds it in the notification center. If the notification fails, Claude Code shows the error inside the app.

### The quality warning

Answers can get less reliable as a conversation grows: details from early on are more easily missed. Cache Keeper cannot measure quality, so it uses the conversation's size as the sign. When `ctx` reaches your handoff threshold, the `ctx` figure turns yellow with `quality may slip`, the Fresh session button appears, and Claude Code shows a message once:

> Context is 520k tokens (52%), past your 50% threshold. Answers may start to slip: consider New session with handoff or Fresh session, above the prompt.

The threshold is 50% of the context window until you change it with `/autohandoff`. It shows again only after the conversation drops back under the threshold, as after `/clear` or `/compact`, and grows past it once more.

## Requirements

- Claude Code 2.1.302 or later (`claude --version`).
- Windows 10 or 11. The mod uses the built-in Windows PowerShell for the notification and to read the cache window.
- The terminal CLI or the Code tab of the Claude Desktop app.
- A Pro or Max plan. The `5h` and `wk` figures are that plan's usage limits.

## Install

Cache Keeper installs from the catalog of mods in [bboyer4806/claude](https://github.com/bboyer4806/claude). In a terminal, run:

```
claude plugin marketplace add bboyer4806/claude
claude plugin install cache-keeper@bboyer4806 --config default_cache_minutes=60
```

Then restart Claude Code: end the terminal session or quit the Desktop app, and start it again. `claude plugin list` shows `cache-keeper@bboyer4806` as enabled.

To update later, run `claude plugin marketplace update bboyer4806`, then `claude plugin update cache-keeper@bboyer4806`, and restart Claude Code.

## The setting

`default_cache_minutes`, shown as "Default cache window (minutes)": the window the countdown uses until Claude Code reports the real one after a reply. Any number from 1 to 60; the default is 60. Until the window is known, it also picks the price for `if cold`: the 1-hour cache price when the setting is over 5 minutes, else the 5-minute price.

To change it, run `/plugin configure cache-keeper@bboyer4806` in Claude Code, then restart Claude Code.

The handoff threshold and automatic handoff are set with `/autohandoff` instead, described below.

## Where the numbers come from

- **cache**: the same rule as the "Prompt cache (main)" line in `/usage`. The cache goes cold one cache window after the last request of the main conversation was sent. After each reply, the mod reads the end of the session transcript through PowerShell to learn the window (5 minutes or 1 hour) from what that reply wrote to the cache. A model switch starts the cache cold, and `/clear` and `/compact` empty it.
- **ctx, 5h, wk, session**: Claude Code's own session usage figures. `session` is the total `/cost` reports, at API list prices. A percentage threshold compares the exact token count with the window, so 499,999 tokens of a 1M window is under 50% even though `ctx` rounds it to 50%.
- **if cold, next msg**: the conversation's size after the last reply, times the model's cache write price. That price is the base input price × 2 for a 1-hour window or × 1.25 for a 5-minute window, × 1.1 for US-only inference, with fast mode prices when fast mode answered, and Haiku 5.5's long-context price above 100,000 tokens. It leaves out your new message and the reply. Prices come from the [Claude pricing page](https://platform.claude.com/docs/en/about-claude/pricing) as of 2026-10-18 and live in `hooks/pricing.ts`. A model missing from that table shows `no price for <model>`.

## New session with handoff

Press `h` in the strip, or run `/handoff`. Either one:

1. Asks Claude for a handoff brief of this conversation: goal, current state, decisions and reasons, open questions, next steps, key files and commands. The strip shows `writing handoff brief...` meanwhile. The brief is one more request over the whole conversation, so it is cheapest while the cache is warm.
2. Saves it to `%USERPROFILE%\.claude\cache-keeper\handoffs\YYYY-MM-DD_HHmm_<project>.md`. The file's header includes `claude --resume <session id>`, which reopens the old session if you need it.
3. Runs `/clear`, which starts a new session.
4. Puts the brief in the new session's prompt box, after "Continue from this handoff brief (saved at <path>):". Nothing is sent until you press Enter, so you can add instructions first.

`/handoff` waits for Claude to finish a reply in progress, then starts once the command is done. If a step fails, the sequence stops and Claude Code shows why. The session is never cleared without a saved brief, and once the brief is saved, the message names its file.

## Fresh session

Past the threshold, `f: Fresh session` starts a new session with no brief: it runs `/clear`. Because it saves nothing, it asks to be confirmed: the first press changes the button to `Confirm fresh session`, and a second press within 5 seconds clears. Otherwise the button goes back to `Fresh session`. Typing `/clear` yourself does the same at any size.

## Automatic handoff

Automatic handoff is off until you turn it on. When it is on, at the 5-minute warning Cache Keeper checks whether you are away and the conversation is at least the handoff threshold. If both hold, it runs New session with handoff in place of the warning, and Windows shows:

> You were away and the prompt cache was 5 minutes from going cold, so Cache Keeper started a new session with a handoff brief. The brief is saved at <path> and waiting in the prompt box.

Away means no reply is in progress and nothing is typed in the prompt box. Reading without typing for the whole cache window counts as away. Cache Keeper checks again once the brief is saved: if you sent a message or started typing in the meantime, it keeps the brief and leaves the session as it was. If the conversation is under the threshold, you are not away, or the brief fails, you get the usual 5-minute warning instead.

### /autohandoff

| Command | What it does |
| --- | --- |
| `/autohandoff` | Shows whether automatic handoff is on, and the threshold. |
| `/autohandoff on` | Turns automatic handoff on, keeping the threshold. |
| `/autohandoff off` | Turns it off, keeping the threshold. The quality warning still uses it. |
| `/autohandoff 50%` | Sets the threshold to a share of the model's context window (1% to 100%) and turns automatic handoff on. |
| `/autohandoff 200k` | Sets the threshold to a token count (`200k`, `1.5m`, or `250000`; 1k to 10M) and turns automatic handoff on. |

A number with no unit under 1,000, such as `50`, is refused rather than guessed at. The setting is kept across sessions and projects, in the mod's store in your Claude Code configuration folder. A session reads it when it starts and again at each 5-minute warning, so a change made in one session reaches the others' automatic handoff right away and their quality warnings after a restart.

## Limits

- Only the main conversation's cache is tracked. Subagents keep their own caches.
- Cache resets other than a model switch, `/clear` and `/compact` are not tracked: changing effort, turning fast mode on or off, and MCP server or plugin changes. After those, the countdown can show warm while the cache is cold; `/usage` shows the real state.
- Context size is only a sign of when quality may slip, not a measure of it. Tune the threshold to when you notice answers drifting.
- Automatic handoff runs only at the 5-minute warning, so not for 5-minute cache windows, and not while the computer sleeps.
- Nothing is drawn in the VS Code chat panel or in cloud sessions, where mods do not draw.
- On a Team or Enterprise account, or a computer where an organization manages Claude Code, Claude Code skips three of the mod's hooks for mods you install yourself: the ones for a finished reply, a session start and a model switch. There, the countdown always uses the setting, and `/clear`, resume and model switches show only after your next message.

## Uninstall

```
claude plugin uninstall cache-keeper@bboyer4806
```

`claude plugin marketplace remove bboyer4806` also removes the catalog, along with any other mod installed from it. Saved briefs stay in `%USERPROFILE%\.claude\cache-keeper\handoffs` until you delete them.
