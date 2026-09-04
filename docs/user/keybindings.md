# Keybindings

Customize shortcuts in **Settings → Keybindings** on web and desktop. That page
also lists the command IDs and defaults available in your version.

## Edit the configuration file

Keybindings live on the environment's machine, in
`~/.t3/userdata/keybindings.json` by default. You can edit this file directly.
It is a JSON array of rules:

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

T3 Code creates the file with its defaults and adds new defaults on later startups.
New defaults do not replace commands you customized. If a new default overlaps one
of your shortcuts, [rule order](#precedence) decides which runs.
Invalid rules are ignored; if the file cannot be parsed, T3 Code uses defaults.

## Rule shape

Each rule requires a `key` shortcut and a `command` ID. An optional `when`
expression restricts when it runs.

Project scripts use `script.{id}.run`, such as `script.test.run`.

## Key syntax

Join modifiers and a key with `+`, such as `mod+shift+d` or `ctrl+l`.
`mod` means Command on macOS and Control elsewhere. Other modifiers are
`cmd` / `meta`, `ctrl` / `control`, `alt` / `option`, and `shift`.

## When conditions

Available context keys are `terminalFocus`, `terminalOpen`, `previewFocus`,
`previewOpen`, and `modelPickerOpen`. Unknown keys evaluate to `false`.

Combine keys with `!` for not, `&&` for and, `||` for or, and parentheses:

`thread.readState.toggle` defaults to `mod+alt+u` and toggles the active server thread between read and unread. The state is stored locally on the client; it does nothing for draft or no-thread routes.

`sidebar.toggle` shows or hides the sidebar and defaults to `mod+b`. `sidebar.version.toggle`
switches between the default sidebar and the legacy one, persists that choice locally, and
defaults to `mod+alt+b` (`⌥⌘B` on macOS and `Ctrl+Alt+B` elsewhere). `rightPanel.toggle` defaults
to `mod+shift+b`.

`rightPanel.toggleMaximized` maximizes or restores the open right panel. It has no default shortcut,
so add one in **Settings** → **Keybindings** if you want to use it.

`rightPanel.close` closes the active right panel tab and defaults to `mod+w`. Press it again to close
the next tab. With the terminal focused, `mod+w` closes the terminal instead, and with nothing left
to close it closes the desktop window as before. Browsers reserve `mod+w` for closing their own tab
and never pass it to the page, so in a browser rebind this command (and `terminal.close`) to a
shortcut the browser leaves alone, such as `alt+w`.

`thread.copyReference` copies the active thread's pull request link, or its thread ID when no pull
request is available. Its default shortcut is `mod+shift+c`, and it does not replace terminal copy
while the terminal has focus.

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

The command palette searches settings, active thread titles, projects, branches, user messages, and
final agent responses across connected environments. A setting result opens its exact control or
section. Message matches show one labeled excerpt while keeping the thread's project, branch, and
machine context visible. Message search begins after two characters and uses SQLite's ASCII
case-insensitive matching.

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

The last rule whose key and condition both match wins, even if it belongs to a
different command. Put a more specific rule after a general one when they share
a shortcut.

## Commands with special behavior

`chat.new` may ask you to choose a project when there is more than one.
`chat.newLocal` skips that chooser. Both use your
[new-thread defaults](./thread-sidebar.md#start-a-thread).

## Reserved shortcuts

In the desktop app, `mod+w` closes the focused terminal or the active right-panel
tab. When nothing remains to close, it closes the window. In a browser, `mod+w`
closes the browser tab; rebind `rightPanel.close` and `terminal.close` to an available
shortcut such as `alt+w`.

Many defaults include `!terminalFocus` so they do not intercept terminal input.
Keep that condition when remapping them if you want the same behavior.

## Desktop quit shortcut

Use `Cmd+Q` on macOS or `Ctrl+Q` on Windows and Linux. In the default **Hold** mode,
hold for 1.2 seconds or press twice within 500 milliseconds. Holding requires
keyboard repeat; if repeat is disabled, use two presses or the application menu.

Change **Settings → General → Confirmations → Quit shortcut** to **Direct** for a
single press or **Double press** for two presses only. Choosing **Quit** from the
application menu always quits immediately.
