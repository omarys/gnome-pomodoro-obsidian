# Pomodoro Obsidian

A GNOME Shell pomodoro timer that logs finished focus time into Obsidian daily
notes and streams lofi from YouTube through `mpv`.

## Requirements

- GNOME Shell 45–50
- `mpv` and `yt-dlp` — mpv uses yt-dlp to resolve YouTube URLs
- [mise](https://mise.jdx.dev) for the dev toolchain (`node`, `pre-commit`)
- `gjs` and `glib-compile-schemas` to build and test

`mise run deps` reports which of these are missing.

## Install

```sh
mise trust            # once, so mise may run this repo's tasks
mise run install
gnome-extensions enable pomodoro-obsidian@omary.local
```

Shell only notices a newly installed extension in a fresh session, so log out
and back in (Wayland) before enabling.

## Configure

Settings → Extensions → Pomodoro Obsidian, or:

```sh
gnome-extensions prefs pomodoro-obsidian@omary.local
```

The vault root defaults to `/home/omary/Documents/Vaults`. The panel menu has a
`Work` field and a `Personal` field; each writes only its own vault, so a phase
with both filled is logged to both daily notes.

Each finished phase appends ` · 25m (2 pomodoros)` to the matching task's line
under `### Focus & Objectives` in `<vault-root>/<vault>/daily/YYYY-MM-DD.md`,
creating the note from that vault's `templates/daily.md` when it is missing. The
work field takes comma-separated Jira keys and resolves their titles from
`<vault-root>/work/jira/`, so a line reads `UPES-2952 Pin component version`
rather than a bare key. The personal field takes tags or plain text.

## Tests

```sh
mise tasks            # every available task
mise run check        # schema + syntax + vault writer into a temp vault + unit tests
mise run check-music  # starts a real mpv at volume 0; needs network, mpv and yt-dlp
```

`mise run check` never touches the real vault — it builds a throwaway one under
`/tmp` and removes it again, and runs the vault-writer test under an in-memory
GSettings backend so it cannot write to your real dconf.

Git hooks are optional. Once this directory is a git repository:

```sh
pre-commit install    # runs `mise run check` before every commit
```

The hooks deliberately just call `mise run`, so the checks live only in
`mise.toml` and cannot drift from what you run by hand.
