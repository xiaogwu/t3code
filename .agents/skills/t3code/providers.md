# Providers

Read this before enabling a provider, fixing a "CLI not found" problem, or adding
a second account.

A provider is the agent runtime T3 Code drives: Codex, Claude, Cursor, Grok
Build, OpenCode, or Antigravity. Installation, login, and credentials belong to
the machine running the server, even when the user is connecting from a phone.

## Enable and Authenticate

**Settings → Providers**, select the environment, enable the provider. Then, on
that machine:

| Provider    | Install and authenticate                                                  |
| ----------- | ------------------------------------------------------------------------- |
| Codex       | [Codex CLI](https://developers.openai.com/codex/cli), then `codex login`   |
| Claude      | [Claude Code](https://claude.com/product/claude-code), then `claude auth login` |
| Cursor      | [Cursor CLI](https://cursor.com/cli), then `agent login`                   |
| Grok Build  | [Grok Build CLI](https://x.ai/cli), then `grok login`                      |
| OpenCode    | [OpenCode](https://opencode.ai), then `opencode auth login`                |
| Antigravity | Sign in with Google from T3 Code's provider settings                       |

Never run a provider's `login` for the user without asking. It is interactive and
it writes their account credentials.

## "T3 Code Cannot Find the CLI"

The provider CLI must be on the **server's** `PATH`, which is not necessarily the
user's interactive shell `PATH` — version managers are the usual culprit, and a
background service or SSH-launched server sees even less.

1. Find the real binary: `command -v codex` (or `claude`, `cursor-agent`, `grok`,
   `opencode`).
2. Set **Binary path** in that provider's settings to the absolute path.
3. Cursor's executable is `cursor-agent` even though its login command is `agent`.
   Antigravity can run its managed runtime with no `PATH` entry.

## Extra Instances

Add another instance of a provider for a separate account or configuration. Each
instance carries its own environment variables — an API key, a custom base URL —
and appears as its own choice in the model picker.

Mark secret values as **sensitive** when saving. T3 Code stores those in
`~/.t3/userdata/secrets/` and does not display them again. Never write a key
directly into `settings.json`, and never read the secrets directory back to
inspect or copy a value.

Instances are recorded under `providerInstances` in `settings.json`, keyed by
instance id. Read it to see what exists; make changes through the UI so secrets
are handled correctly.

## Keeping CLIs Current

A provider card shows the available version when its CLI is behind. **Update now**
appears only when T3 Code can tell which installer owns the CLI — its own update
command, Homebrew, or a global npm, pnpm, bun, or Vite+ install — and then runs
that installer. Otherwise update the CLI the way it was installed. Homebrew
installs compare against Homebrew's version, which can trail the npm release by
hours.

`enableProviderUpdateChecks` in `settings.json` turns the checking off.

## When a Provider Misbehaves

Provider traffic is logged on the server at
`~/.t3/userdata/logs/provider/events.log`, with per-provider logs beside it. Read
those before guessing. A CLI whose own login has expired or whose usage limit is
spent fails fast and can look like a broken integration rather than an account
problem — check by running the CLI once in a terminal.

Further reading: [provider setup](https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md#providers),
[Codex](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-codex.md),
[Claude](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md),
[OpenCode](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-opencode.md),
[Antigravity](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-antigravity.md).
