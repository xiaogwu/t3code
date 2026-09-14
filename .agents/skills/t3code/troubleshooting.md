# Diagnosing and Reporting

Read this when something about the install is broken, before changing anything.

## Do Not Kill Processes by Pattern

**A T3 Code server is very often the process hosting the agent session doing this
work.** `pkill -f t3`, `pgrep | kill`, or killing a PID matched by name or path can
kill the user's session, their other threads, and the agent running the command.

- Never match a process by name, path, or port label and kill it.
- Read `~/.t3/userdata/server-runtime.json` for the recorded host, port, and PID
  before reasoning about what is running.
- Restarting or stopping a server is the user's call. Hand them the command.

## Gather Facts First

```bash
npx t3 --version                              # CLI version
cat ~/.t3/userdata/server-runtime.json         # Recorded host, port, pid
tail -200 ~/.t3/userdata/logs/server.log       # Server log
tail -100 ~/.t3/userdata/logs/provider/events.log
```

| Where                              | What is in it                            |
| ---------------------------------- | ---------------------------------------- |
| `logs/server.log`                  | Server log                               |
| `logs/server.trace.ndjson`         | Structured trace spans                   |
| `logs/provider/`                   | Provider protocol traffic, `events.log`   |
| `logs/terminals/`                  | Terminal session output                  |
| `settings.json`                    | What is actually configured              |
| `server-runtime.json`              | Whether a server is live, and where      |

Check the state directory the user's app actually uses. `~/.t3/userdata` is the
installed app's state; `~/.t3/dev` is used by a server pointed at a dev web URL,
and `T3CODE_HOME` or `--base-dir` moves the whole tree. Reading the wrong one is
the most common way to conclude "the setting isn't there".

To inspect `state.sqlite`, snapshot it rather than opening the live file:

```bash
bun -e "new (require('bun:sqlite').Database)(process.env.HOME + '/.t3/userdata/state.sqlite', { readonly: true }).run(\"VACUUM INTO '/tmp/t3-snapshot.sqlite'\")"
```

`VACUUM INTO` is safe while a server has the file open and refuses to overwrite an
existing target. A plain `cp` of a live database is a corrupt copy.

## Common Confusions

| Symptom                                     | Likely cause                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| A setting "disappeared"                     | Invalid JSON in `settings.json` — the file falls back to defaults silently   |
| A provider shows as unavailable             | CLI not on the **server's** `PATH`, or its own login expired ([`providers.md`](providers.md)) |
| Changes not visible on another device       | Per-device preferences, or a different environment ([`settings.md`](settings.md)) |
| Environment offline from a phone            | Host asleep, or service not lingering ([`service.md`](service.md), [`remote.md`](remote.md)) |
| Threads did not come back after a restart   | **Continue threads after restarts** is off by default ([`service.md`](service.md)) |
| Agent work cannot read Desktop or Documents | macOS Full Disk Access for the service's Node executable ([`service.md`](service.md)) |

## `t3 triage`

`npx t3 triage` collects machine facts into a `context.md` and launches `claude` or
`codex` interactively to investigate and help file an issue.

**Do not run it from inside an agent session** — it wants a terminal and its own
agent. Gather the facts above yourself, and hand the user the command if they want
the guided flow.

## Filing an Issue

T3 Code lives at <https://github.com/pingdotgg/t3code>, and
[`CONTRIBUTING.md`](https://github.com/pingdotgg/t3code/blob/main/CONTRIBUTING.md)
is the authority on what is accepted.

- **Verified bugs** → issues.
- **Feature requests and proposals** → [Ideas discussions](https://github.com/pingdotgg/t3code/discussions/categories/ideas).

Include: what happened, what was expected, steps to reproduce, T3 Code version,
platform, which surface (web, desktop, mobile) and which provider, and the relevant
log excerpt. A screen recording is worth more than a paragraph for anything visual;
save it and give the user the path, since attachments are added by drag-and-drop in
the web form.

**Redact before attaching.** Logs and screenshots can carry pairing URLs, tokens,
API keys, absolute paths, and repository contents. Never paste a pairing URL or a
`secrets/` value into an issue.

```bash
gh issue create --repo pingdotgg/t3code --title "..." --body "..."
```

Ask before filing. An issue is public and posted under the user's account.
