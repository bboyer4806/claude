# Assumption Tracker

A Claude Code mod that shows what Claude assumed. After each task, Claude lists the choices it made that you did not spell out, and a strip above the prompt box says how many. Mark each one Right or Wrong, and Claude fixes only the wrong ones.

```
Claude made 3 assumptions.  0: review
```

## How it works

1. When Claude finishes a task, the mod asks Claude to list every assumption it made that you did not explicitly specify: how it read the request, scope, defaults, names, file locations, libraries, formats, edge cases. It gets at most 12, most important first. The question goes to a side copy of the conversation, so nothing is added to your transcript.
2. While that runs (a few seconds), the strip reads `Checking what Claude assumed...`. Then it reads `Claude made N assumptions.` If there were none, there is no strip. The strip hides while Claude is working.
3. Press `0` in an empty prompt box to open the list. You can also click `review`, or run `/assumptions`. Outside the strip, a prompt that starts with 0 types normally.
4. Tab moves through the list, and `›` marks the assumption you are on. For each one, choose `✓ Right` or `✗ Wrong`, and type a note if you like (what it should have been). Choosing Wrong moves you to its note. Choosing Right moves you to the next assumption. Choosing the same answer again clears it.
5. Close the list with the `Send N fixes to Claude` button or Esc. If anything is marked Wrong, the mod sends Claude one message, as you. Items you left unmarked are not mentioned.
6. Once closed, the list is read-only: `/assumptions` shows your marks and sends nothing. Claude's fix is a task too, so it gets its own check.

The message looks like this:

```
I reviewed the assumptions you made in your last task. Fix only what I marked wrong, and keep everything else as it is.

Wrong, fix these:
1. Used Python 3.12
   My note: Use 3.11

Right, keep these exactly as they are:
- Saved the output as CSV

Change only what these fixes need. Don't redo or restyle the rest of the work.
```

A wrong item with no note asks Claude to work out the right choice from your request, and to ask you if it is still unclear.

## Requirements

- Claude Code 2.1.299 or later (`claude --version`).
- The terminal CLI or the Code tab of the Claude Desktop app.

## Install

Assumption Tracker installs from the catalog of mods in [bboyer4806/claude](https://github.com/bboyer4806/claude). In a terminal, run:

```
claude plugin marketplace add bboyer4806/claude
claude plugin install assumption-tracker@bboyer4806
```

Then restart Claude Code: end the terminal session or quit the Desktop app, and start it again. `claude plugin list` shows `assumption-tracker@bboyer4806` as enabled.

At the prompt of a terminal session, this does both steps at once:

```
/plugin install assumption-tracker --marketplace bboyer4806/claude
```

In the Desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `bboyer4806/claude`, then Add plugin.

To update later, run `claude plugin marketplace update bboyer4806`, then `claude plugin update assumption-tracker@bboyer4806`, and restart Claude Code.

## Cost

Each check is one more request over the whole conversation, on the session's model. While the prompt cache is warm, most of that request is read from the cache, which costs much less than sending it fresh. The reply is short: just the list.

## Limits

- The list is Claude's own account of what it assumed. It can miss a choice, or list one you did state.
- Only the main conversation is checked. Subagents and interrupted turns are skipped.
- Nothing is drawn in the VS Code chat panel, the mobile app or cloud sessions.
- On a Team or Enterprise account, or a computer where an organization manages Claude Code, Claude Code may skip the hook for a finished reply in mods you install yourself (see Cache Keeper's Limits). If it does, no check runs and the strip never appears.

## Tests

`claude plugin test assumption-tracker` runs the tests. They cover the strip, the `0` button, marking, notes, the fix message, sending it only once, sending nothing when nothing is wrong, and the turns that are skipped, in both the terminal and the Desktop app. The move to the note or the next assumption after a mark is not covered by the tests, because the test kit cannot simulate it.

## Uninstall

```
claude plugin uninstall assumption-tracker@bboyer4806
```
