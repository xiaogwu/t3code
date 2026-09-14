# Settings and Keybindings

Read this before changing environment settings or shortcuts.

## The State Directory

The T3 home defaults to `~/.t3`. `T3CODE_HOME`, or `--base-dir` on most `t3`
commands, moves it. Runtime state lives in that directory's `userdata`
subdirectory; a server started against a dev web URL uses `dev` instead, which is
why a source checkout and an installed app do not share state.

Settings belong to the machine running the server. A phone or browser connected
to that machine reads and writes its settings, not its own.

## `settings.json`

`~/.t3/userdata/settings.json` holds the environment's server-authoritative
settings: what the server does, regardless of which client is looking. The server
watches the file and applies outside edits, and writes it back atomically when
the UI changes something.

Useful keys — read the file for the rest, and prefer the matching Settings page
when there is one:

| Key                              | Effect                                                     |
| -------------------------------- | ---------------------------------------------------------- |
| `defaultModelSelection`          | Model new threads start with                                |
| `providerInstances`              | Provider instances, binaries, environment variables         |
| `defaultThreadEnvMode`           | `worktree` or `local` for new threads                       |
| `newWorktreesStartFromOrigin`    | Branch new worktrees from the upstream default branch       |
| `defaultAutoPull`                | Keep default-branch checkouts fast-forwarded                |
| `defaultProjectScripts`          | Scripts inherited by projects without their own list        |
| `projectScriptOverrides`         | Per-project script lists, keyed by project id               |
| `continueThreadsAfterServerUpdate` | Resume supported threads after a restart                  |
| `enableAgentBrowserAccess`       | Whether agent sessions may drive the in-app browser         |
| `defaultTheme`                   | Environment theme default — set it with `t3 theme` instead   |

Rules that make hand-editing safe:

- Keep it valid JSON. A file that cannot be parsed falls back to defaults
  silently, which reads as "my settings vanished".
- Values are validated against the settings schema; an unknown or out-of-range
  value is discarded rather than honored.
- Back up first: `cp settings.json settings.json.bak.$(date +%s)`.
- Do not write secrets in plain text. Mark sensitive provider values as sensitive
  in the UI so they land in `secrets/` instead — see [`providers.md`](providers.md).

## Per-device Settings

`client-settings.json` and `desktop-settings.json` in the same directory belong to
the app, and appearance preferences are saved per device or browser. Change them
through the client's Settings pages, not by editing the files.

## Keybindings

`~/.t3/userdata/keybindings.json` is a JSON array of rules. T3 Code creates it
with its defaults and adds new defaults on later startups without replacing
commands you customized.

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

- `key` joins modifiers with `+`. `mod` is Command on macOS, Control elsewhere;
  the others are `cmd`/`meta`, `ctrl`/`control`, `alt`/`option`, and `shift`.
- `command` is a command ID. **Settings → Keybindings** lists the IDs and defaults
  for the installed version — check there before inventing one. Project scripts
  use `script.{id}.run`.
- `when` restricts the rule. Available context keys are `terminalFocus`,
  `terminalOpen`, `previewFocus`, `previewOpen`, and `modelPickerOpen`; unknown
  keys are `false`. Combine with `!`, `&&`, `||`, and parentheses.
- **The last matching rule wins**, even across commands. Put the specific rule
  after the general one when they share a shortcut.
- Invalid rules are ignored; an unparseable file falls back to defaults.

Many defaults carry `!terminalFocus` so they do not swallow terminal input. Keep
that condition when remapping them.

`mod+w` is reserved: in the desktop app it closes the focused terminal or panel
tab, and in a browser the browser takes it — rebind `terminal.close` and
`rightPanel.close` to something like `alt+w` for web.

## After Editing

Tell the user what changed and what to look at. If a rebind replaced an existing
shortcut, say which command lost it.
