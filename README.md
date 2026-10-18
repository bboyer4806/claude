# Claude mods

Brian Boyer's mods for Claude Code, published as one plugin catalog.

| Mod | What it does |
| --- | --- |
| [Cache Keeper](cache-keeper/README.md) | A strip above the prompt with the prompt cache countdown, context size, usage limits and session cost; a Windows warning before the cache goes cold; and a one-press Handoff & Clear. |

## Install a mod

Add this catalog once:

```
claude plugin marketplace add bboyer4806/claude
```

Then install a mod by name, for example `claude plugin install cache-keeper@bboyer4806`, and restart Claude Code. Each mod's README has its exact install line and settings.

## Layout

Each mod lives in its own folder with its own `.claude-plugin/plugin.json`. The catalog, `.claude-plugin/marketplace.json`, lists every mod by folder; a new mod gets a folder and an entry there.
