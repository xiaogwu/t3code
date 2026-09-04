# Install T3 Code

T3 Code runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Requirements

Command-line use, SSH hosts, and WSL backends need Node.js 22.16+ (22.x), 23.11+
(23.x), or 24.10 and later. The native desktop app includes its server runtime.

You need an installed, authenticated provider before starting a thread. You can
launch T3 Code and configure providers afterwards.

## Run without installing

```bash
npx t3@latest
```

This starts the server and opens the local web app. Run
`npx t3@latest --help` for command-line options.

## Desktop app

Download a release from [GitHub Releases](https://github.com/pingdotgg/t3code/releases),
or use a package manager:

| Platform           | Install                         |
| ------------------ | ------------------------------- |
| Windows            | `winget install T3Tools.T3Code` |
| macOS              | `brew install --cask t3-code`   |
| Arch Linux         | `yay -S t3code-bin`             |
| Arch Linux nightly | `yay -S t3code-nightly-bin`     |

On macOS, the running app's Dock icon follows the colors of the active T3 Code theme. Finder and
Launchpad continue to show the installed build's regular app icon.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install Node.js and provider CLIs inside that distro. T3 Code installs its
matching server runtime there automatically; the first launch after an app
update can take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
npx t3 app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `npx t3 app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Mobile app

Install T3 Code from the
[App Store](https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824) or
[Google Play](https://play.google.com/store/apps/details?id=com.t3tools.t3code).
The phone connects to a server on another machine. Follow
[remote access](./remote-access.md) to link it through T3 Connect or a pairing URL.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider            | CLI                                                                                                        | Default binary     | Log in with                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------- |
| Codex               | [Codex CLI](https://developers.openai.com/codex/cli)                                                       | `codex`            | `codex login`                      |
| Claude              | [Claude Code](https://claude.com/product/claude-code)                                                      | `claude`           | `claude auth login`                |
| Cursor              | [Cursor CLI](https://cursor.com/cli)                                                                       | `cursor-agent`     | `agent login`                      |
| Grok Build          | [Grok Build CLI](https://x.ai/cli)                                                                         | `grok`             | `grok login`                       |
| Apple Gemini        | Apple Gemini CLI                                                                                           | `apple-gemini`     | existing Apple auth                |
| Antigravity CLI     | [Antigravity CLI](https://antigravity.google/docs/cli/)                                                    | `agy`              | Run `agy` once                     |
| OpenCode            | [OpenCode](https://opencode.ai)                                                                            | `opencode`         | `opencode auth login`              |
| Antigravity managed | [Official ACP agent](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json) | Managed by T3 Code | **Sign in with Google** in T3 Code |

Codex, Claude, and Antigravity CLI are on by default. Cursor, Grok Build, Apple Gemini, OpenCode,
and managed Antigravity are off by default. Turn them on in **Settings** > **Providers** when you
want to use them.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, T3 Code does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md), and
[Antigravity](./providers-antigravity.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating T3 Code](./updating.md): update the app and connected servers.
