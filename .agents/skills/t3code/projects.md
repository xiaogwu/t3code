# Projects, `t3.json`, and Worktrees

Read this before changing how a repository behaves in T3 Code, or before adding
project scripts.

## Three Places a Project Setting Can Live

1. **`t3.json`** at the repository root — checked in, shared with everyone who
   opens the repository.
2. **Per-project settings** in **Settings → Projects** — this machine, this
   project. Overrides `t3.json`.
3. **Machine defaults** in the same place, applied to projects that inherit.

`t3.json` beats a machine default; an explicit per-project override beats
`t3.json`. Changing a default preserves explicit overrides.

## `t3.json`

```json
{
  "$schema": "https://t3.codes/schema/t3.json",
  "iconPath": "assets/logo.svg",
  "defaultThreadEnvMode": "worktree",
  "scripts": [
    { "name": "install", "command": "pnpm install", "runOnWorktreeCreate": true },
    { "name": "dev", "command": "pnpm dev", "previewUrl": "http://localhost:5173", "autoOpenPreview": true }
  ]
}
```

- `defaultThreadEnvMode` — `worktree` starts each thread in a fresh git worktree,
  `local` uses the current checkout.
- `scripts` — up to 50 entries, each with `name` and `command`, run in a T3 Code
  terminal at the project root. Optional `icon`, `runOnWorktreeCreate` to run it
  automatically after a worktree is created for a new thread, and `previewUrl` plus
  `autoOpenPreview` to open the in-app browser (desktop build only).
- `iconPath` — workspace-relative image, checked before T3 Code's built-in icon
  detection.

It is a checked-in file, so treat it like any source change: it affects the
user's teammates. Say so before adding a script that runs on its own.

Scripts a user edits inside T3 Code become that project's own list in
`settings.json` (`projectScriptOverrides`) rather than editing `t3.json`. Reset
the list to go back to inheriting shared scripts.

## Managing Projects

```bash
npx t3 project add <path> --title "Name"   # Add a workspace root as a project
npx t3 project rename <id-or-path> "Name"
npx t3 project remove <id-or-path>         # --force also deletes all of its threads
npx t3 app [path]                          # Open a directory as a thread in the running desktop app
```

`t3 project remove --force` destroys conversation history. Confirm before running
it.

`t3 app` needs the desktop app already running on the same machine; a standalone
server or an SSH session is not enough.

## Worktrees

Thread worktrees live under `~/.t3/worktrees/`. Each belongs to a live thread, so
never delete one by hand or reuse it for other work — remove it through the app.
`newWorktreesStartFromOrigin` in `settings.json` controls whether a new worktree
branches from the upstream default branch instead of the current checkout.

## Automatic Pull

**Automatically pull** keeps the default-branch checkout current. T3 Code only
pulls when it can fast-forward and the checkout has no changed files, untracked
files, or local commits, and it skips checkouts on another branch or without an
upstream. Local work left in the default checkout silently stops auto-pull until
it is resolved.

Further reading: [project settings](https://github.com/pingdotgg/t3code/blob/main/docs/user/project-settings.md),
[working with threads](https://github.com/pingdotgg/t3code/blob/main/docs/user/thread-sidebar.md).
