# Keybindings

Edit keybindings from **Settings** → **Keybindings**. That page lists every command, its current
shortcut, whether it is a default or your own, and warns about conflicts.

The same configuration lives in `~/.t3/userdata/keybindings.json` on the machine running the
server, if you prefer editing it directly. T3 Code writes the built-in defaults into that file on
first run, and adds any new defaults on later startups unless a rule of yours already claims the
command or the shortcut.

The file is a JSON array of rules.

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

Invalid rules are ignored. An invalid file is ignored entirely, and the server logs a warning.

## Rule Shape

- `key` (required): shortcut string, like `mod+j`, `ctrl+k`, `cmd+shift+d`
- `command` (required): the command ID to run
- `when` (optional): boolean expression controlling when the shortcut is active

## Key Syntax

Modifiers: `mod` (`cmd` on macOS, `ctrl` elsewhere), `cmd` / `meta`, `ctrl` / `control`, `shift`,
`alt` / `option`.

Examples: `mod+j`, `mod+shift+d`, `ctrl+l`, `cmd+k`.

## Commands

Commands are IDs like `terminal.toggle`, `commandPalette.toggle`, `preview.refresh`, and
`chat.new`. Project scripts are addressable as `script.{id}.run`, for example `script.test.run`.

`filePicker.toggle` opens file search for the active project and defaults to `mod+p`.
`projectSearch.toggle` searches inside the active project's files and defaults to `mod+shift+f`.
Repeating either shortcut closes that search, and switching shortcuts replaces the open search.
`themeEditor.toggle` opens or closes the floating theme editor and defaults to
`mod+alt+shift+t`. Select a color label to spotlight the elements that use it; select the label
again to clear the spotlight. The swatch and hex field keep that color selected while you edit it.
Advanced mode groups related app tokens into a smaller set of color families. Changing a family
updates its paired text and interaction states while leaving every unrelated imported color intact.
Use **Inspect** to pick an element in the app and reveal its color token. Inspect disarms after one
successful pick; its hover glow and badge preview the element and color family that click will select.
**Cancel** or `Escape` exits Inspect and clears its selection and spotlight.

`thread.readState.toggle` defaults to `mod+alt+u` and toggles the active server thread between read and unread. The state is stored locally on the client; it does nothing for draft or no-thread routes.

`sidebar.toggle` shows or hides the sidebar and defaults to `mod+b`. `sidebar.version.toggle`
switches between the default sidebar and the legacy one, persists that choice locally, and
defaults to `mod+alt+b` (`⌥⌘B` on macOS and `Ctrl+Alt+B` elsewhere). `rightPanel.toggle` defaults
to `mod+shift+b`.

`rightPanel.toggleMaximized` maximizes or restores the open right panel. It has no default shortcut,
so add one in **Settings** → **Keybindings** if you want to use it.

`thread.settle` settles the active thread or restores it when it is already settled. Its default
shortcut is `mod+shift+s`, and it does not run while the terminal has focus.

`thread.pin` pins the active thread to the pinned section of the sidebar, or unpins it when it is
already pinned. Its default shortcut is `mod+shift+p`, and it does not run while the terminal has
focus. See [Organizing threads](./thread-sidebar.md) for how pinned threads are ordered.

`shell.openInTerminal` opens the active worktree (or project workspace when no worktree is
attached) in a native terminal on the machine running the T3 server. It defaults to
`mod+shift+t` and is disabled while the embedded terminal has focus. This command is separate
from `terminal.toggle`, which controls T3's embedded terminal panel.

Choose the native terminal in **Settings** → **General** → **External terminal**. **Automatic**
uses the host platform's best available option: Terminal.app on macOS, Windows Terminal or
PowerShell on Windows, and the configured `$TERMINAL`/available terminal emulator on Linux. There
is no dependable cross-platform system API for reading a user's default terminal, so explicit
selection is available when automatic detection is not suitable. Remote connections launch on
the environment host, not on the device viewing T3.

The command palette searches active thread titles, projects, branches, user messages, and final
agent responses across connected environments. Message matches show one labeled excerpt while
keeping the thread's project, branch, and machine context visible. Message search begins after two
characters and uses SQLite's ASCII case-insensitive matching.

Use the **Archived** toggle in the command palette, or type `is:archived`, to search only archived
threads. With no other search text, the palette shows recently archived threads. Selecting an
archived result unarchives and opens it. Ordinary search already includes settled threads; settled
and archived are separate states.

The full command list and the current defaults are shown in **Settings** → **Keybindings**, which
always matches the build you are running. Use that rather than a copied list.

## Composer prompt history

With an empty message composer, press Up Arrow to recall your most recently sent prompt. Keep
pressing Up to walk backward through up to 50 saved prompts; Down Arrow walks forward again and
returns to an empty composer after the newest prompt. Editing a recalled prompt ends that walk, so
the arrow keys go back to normal text navigation. Prompt history is shared across threads and
projects, survives reloads, and stores prompt text only.

Press Ctrl+R while the composer is focused to search that history. Type to filter, use Up and Down
or press Ctrl+R again to move through matches, press Enter to restore the highlighted prompt, and
press Escape to close the search without changing the current draft.

Note that `chat.new` and `chat.newLocal` both create a thread through the same path. A new thread
inherits the project you were in, along with model and mode selections. Branch, worktree, and
environment mode always come from your configured defaults, not from the thread you were looking
at. To keep a worktree, use the explicit "new thread in this worktree" action in the branch
toolbar. The only difference between the two commands: with the current sidebar and more than one
project, `chat.new` opens a project chooser first.

Background submission from a new thread is the exception. `mod+enter` starts that thread and opens
another new thread with the same workspace mode and base branch. **New worktree** remains selected,
but the new thread does not reuse the worktree created for the thread that just started.

## `when` Conditions

A `when` expression is evaluated against context keys describing the current UI state. The keys
the app supplies today are `terminalFocus`, `terminalOpen`, `previewFocus`, `previewOpen`, and
`modelPickerOpen`. The set is open and grows over time, so treat that as the current list rather
than a fixed one. Any key the running app does not supply evaluates to `false`.

Operators: `!` (not), `&&` (and), `||` (or), and parentheses.

Examples:

- `"when": "terminalFocus"`
- `"when": "terminalOpen && !terminalFocus"`
- `"when": "!terminalFocus"`

## Precedence

- Rules are evaluated in array order.
- For a key event, the last rule where both `key` matches and `when` evaluates to `true` wins.
- Precedence is across commands, not only within the same command. A later rule for a different
  command can take a key away from an earlier one.
