---
name: t3code
description: >
  REQUIRED for configuring, customizing, or troubleshooting an installed T3 Code
  environment. Use when editing ~/.t3/userdata/settings.json,
  ~/.t3/userdata/keybindings.json, ~/.t3/userdata/themes/, or a repository's
  t3.json. Triggers: T3 Code settings, providers (Codex, Claude, Cursor, Grok,
  OpenCode, Antigravity), provider binary paths or extra instances, default
  model, keybindings, themes and appearance, project scripts, worktree defaults,
  auto-pull, pairing a phone or another machine, T3 Connect, Tailscale HTTPS, SSH
  environments, background service, server updates and version mismatches, and
  `t3` command-line usage. Excludes development of T3 Code itself.
---

# T3 Code Skill

Configure and operate an installed [T3 Code](https://t3.codes) environment — the
server that runs coding agents on a machine, plus the web, desktop, and mobile
clients that drive it.

This skill is for running and customizing an install. It is not for contributing
to T3 Code's source.

## When This Skill MUST Be Used

**ALWAYS invoke this skill for requests involving ANY of these:**

- Editing ANY file under `~/.t3/` (or the state directory named by `T3CODE_HOME`)
- Editing a repository's `t3.json`
- Providers: enabling, authenticating, binary paths, extra instances, API keys
- Default model, text-generation model, or per-project model defaults
- Keybindings and shortcuts
- Themes, appearance, fonts, panel motion
- Project scripts, worktree-vs-local defaults, automatic pull, project icons
- Connecting a phone, browser, or another desktop to this machine
- T3 Connect, pairing links, Tailscale HTTPS, SSH environments, revoking access
- Running T3 Code as a background service, or fixing an app/server version mismatch
- Diagnosing a misbehaving install, or filing a T3 Code bug

**If you are about to edit a file under `~/.t3/`, STOP and use this skill first.**

**Do NOT use this skill to work on T3 Code's source tree.** Building, testing, or
changing T3 Code itself follows the repository's `AGENTS.md`.

## Topic Guides

Deeper instructions live next to this file. Read the matching guide before
starting:

- [`settings.md`](settings.md) - the state directory, `settings.json`, and keybindings
- [`providers.md`](providers.md) - provider setup, extra instances, binaries, secrets
- [`projects.md`](projects.md) - projects, `t3.json`, scripts, worktrees
- [`remote.md`](remote.md) - pairing, T3 Connect, Tailscale, SSH, revoking access
- [`service.md`](service.md) - background service and keeping app and server in sync
- [`themes.md`](themes.md) - appearance and publishing environment themes
- [`troubleshooting.md`](troubleshooting.md) - logs, diagnostics, and filing issues

## Critical Safety Rules

**The state directory is a live application, not a config folder.** A server is
usually running against it while you work, with real threads and agent processes
attached.

- **NEVER hand-edit `state.sqlite`** (or its `-wal` / `-shm` siblings). It holds
  every project, thread, and event. Reading is fine — snapshot it first with
  `VACUUM INTO` rather than copying a live file.
- **NEVER start a second server against a state directory already in use.**
- **NEVER edit files inside the installed app** (the Electron bundle, or the
  `npx` package cache). Updates replace them. Change behavior through settings,
  the `t3` CLI, or the UI.
- **NEVER read, print, or copy `~/.t3/userdata/secrets/`, `clerk-tokens.json`, or
  pairing URLs and tokens.** Treat pairing URLs as passwords: they do not belong
  in logs, screenshots, or bug reports.
- **Ask before anything that restarts the server.** Restarts, updates, and
  service install/uninstall interrupt running agents and terminal commands.
  Threads, settings, and project files survive; in-flight work may not.
- **Do not delete directories under `~/.t3/worktrees/`.** They are the working
  copies for threads. Remove them through the app.

**Reading the state directory is safe and useful** — do it freely to answer
questions: check `settings.json` for what is configured, `logs/` for what
happened, `server-runtime.json` for whether a server is live and on which port.

## Command Discovery

T3 Code ships one `t3` CLI. Run it with `npx t3` (or `t3` when it is on `PATH`);
`npx t3@latest` pins the newest release. Always confirm a command from `--help`
rather than memory — the surface changes between releases.

```bash
npx t3 --help                 # Top-level commands
npx t3 connect --help          # Commands inside a group
npx t3 pair --help             # Flags for one command (does not run it)
```

**Running bare `t3` or `t3 start` starts a server and opens a browser.** Never
use it to "check" something. Use `--help`, read the state directory, or ask the
user to look at the app.

### Command Groups

| Command                | Purpose                                                | Example                        |
| ---------------------- | ------------------------------------------------------ | ------------------------------ |
| `t3` / `t3 start`      | Run the server and open the local web app              | `npx t3@latest`                |
| `t3 serve`             | Run headless and print pairing details                 | `npx t3 serve --host 10.0.0.4` |
| `t3 app [path]`        | Open a directory as a thread in the running desktop app | `npx t3 app ../my-project`     |
| `t3 pair`              | Mint a pairing link for an already-running server      | `npx t3 pair --tailscale`      |
| `t3 auth`              | Pairing tokens and bearer sessions for headless hosts   | `npx t3 auth pairing list`     |
| `t3 project`           | Add, rename, or remove a project                       | `npx t3 project add .`         |
| `t3 connect`           | Set up and inspect T3 Connect                          | `npx t3 connect status`        |
| `t3 service`           | Install, update, or remove the background service      | `npx t3 service status`        |
| `t3 theme`             | Environment-wide theme default                         | `npx t3 theme set nightfall`   |
| `t3 triage`            | Hand a misbehaving install to an interactive agent CLI  | `npx t3 triage`                |

## Where Things Live

The T3 home defaults to `~/.t3`. `T3CODE_HOME` — or `--base-dir` on most
commands — moves it; runtime state stays under that directory's `userdata`.

```
~/.t3/
├── userdata/                 # Runtime state
│   ├── settings.json         # Environment settings - SAFE TO EDIT
│   ├── keybindings.json      # Shortcuts - SAFE TO EDIT
│   ├── themes/               # Published environment themes - SAFE TO ADD
│   ├── state.sqlite          # Projects, threads, events - NEVER HAND-EDIT
│   ├── secrets/              # Provider secrets - NEVER READ OR COPY
│   ├── logs/                 # server.log, server.trace.ndjson, provider/, terminals/
│   ├── server-runtime.json   # Live server host, port, pid
│   ├── client-settings.json  # Per-device client prefs - app-owned
│   └── desktop-settings.json # Desktop shell prefs - app-owned
├── worktrees/                # Thread worktrees
└── caches/
```

A checked-in `t3.json` at a repository root carries per-project configuration for
everyone who opens that repository — see [`projects.md`](projects.md).

## Safe Customization Patterns

The server watches `settings.json` and `keybindings.json` and picks up outside
edits, so editing them by hand is supported:

```bash
# 1. Read what is there
cat ~/.t3/userdata/settings.json

# 2. Back up before changing
cp ~/.t3/userdata/settings.json ~/.t3/userdata/settings.json.bak.$(date +%s)

# 3. Edit with the Edit tool, keeping valid JSON

# 4. Confirm it took effect in the app
```

Write a temporary file in the same directory and rename it into place when a
generator produces the content, so a watcher never reads a half-written file.
Required for theme files; good practice for the rest.

An unparseable file falls back to defaults instead of failing loudly, so a
syntax error looks like "my settings disappeared". Validate the JSON after
editing.

Settings the UI owns are better set in the UI. Per-device preferences —
appearance, fonts, panel animation — live in each client, not in the
environment's `settings.json`.

## Decision Framework

1. **Per-device look and feel?** (theme, fonts, motion) Set it in the client's
   **Settings → Appearance**; see [`themes.md`](themes.md).
2. **Environment-wide behavior?** (providers, default model, project defaults,
   auto-pull) **Settings → ...** in the app, or `settings.json` — see
   [`settings.md`](settings.md).
3. **A shortcut?** `~/.t3/userdata/keybindings.json` or **Settings → Keybindings**.
4. **Shared with the repository's other users?** `t3.json` — see
   [`projects.md`](projects.md).
5. **Access from another device?** See [`remote.md`](remote.md).
6. **Host must stay up, or app and server disagree on version?** See
   [`service.md`](service.md).
7. **Something is broken?** See [`troubleshooting.md`](troubleshooting.md).
8. **Unsure a command exists?** Run `npx t3 --help`, then the group's `--help`.

## Out of Scope

This skill does not cover developing T3 Code. Do not use it for:

- Editing the T3 Code source tree, or running its dev servers, tests, or builds
- Anything the repository's `AGENTS.md` and `docs/internals/` govern

## Example Requests

- "Use Claude by default for new threads" -> **Settings → Models**, or `defaultModelSelection` in `settings.json`
- "T3 Code can't find my codex binary" -> set **Binary path** in provider settings; see [`providers.md`](providers.md)
- "Add a second Codex account" -> add a provider instance with its own environment variables ([`providers.md`](providers.md))
- "Bind Cmd+G to the terminal" -> add `{ "key": "mod+g", "command": "terminal.toggle" }` to `keybindings.json` ([`settings.md`](settings.md))
- "New threads should start in the current checkout, not a worktree" -> `defaultThreadEnvMode` in `t3.json`, or the per-project setting ([`projects.md`](projects.md))
- "Run pnpm install automatically for every new worktree" -> a `t3.json` script with `runOnWorktreeCreate: true` ([`projects.md`](projects.md))
- "Let me use this from my phone" -> `npx t3@latest connect`, or `npx t3 pair` on a reachable network ([`remote.md`](remote.md))
- "Revoke my old laptop's access" -> **Settings → Connections**, or `npx t3 auth session revoke <id>` ([`remote.md`](remote.md))
- "Keep it running after I close the terminal" -> `npx t3@latest service install` ([`service.md`](service.md))
- "The app says my server is out of date" -> update the machine named in the notice ([`service.md`](service.md))
- "Make everyone on this server default to my theme" -> save the theme JSON in `~/.t3/userdata/themes/`, then `t3 theme set <id>` ([`themes.md`](themes.md))
- "T3 Code is behaving strangely" -> gather version, paths, and logs before changing anything ([`troubleshooting.md`](troubleshooting.md))
