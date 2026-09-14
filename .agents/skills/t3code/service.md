# Background Service and Updates

Read this before installing the background service, or when the app reports that a
server is out of date.

**Both operations restart the server.** That interrupts running agents and
terminal commands; threads, settings, and project files survive. Ask first, and
check whether work is in flight.

## Background Service

Linux and macOS can run T3 Code as a service for the user's own account, so no
terminal has to stay open. Windows is not supported.

| Task                          | Command                           |
| ----------------------------- | --------------------------------- |
| Install and start             | `npx t3@latest service install`   |
| Status and log location       | `npx t3@latest service status`    |
| Update or repair              | `npx t3@latest service update`    |
| Stop and remove from startup  | `npx t3@latest service uninstall` |

Install and update use the version of the CLI invoked — `npx t3@nightly ...`, or an
exact version to pin. An older CLI refuses to replace a newer service unless
`--allow-downgrade` is passed. Uninstalling leaves projects, threads, and settings
intact.

Linux needs systemd user services, and setup enables lingering so the service
survives logout. macOS starts the service at login and stops it at logout, so the
Mac has to stay logged in and awake for unattended access. Installing over SSH
while nobody is logged in at the Mac's screen can fail at the final start step —
the service is installed and starts at the next login.

T3 Connect can offer service installation, but the two are managed separately.
Signing out of Connect does not stop the service.

### When the Service Will Not Stay Up

Start with `t3 service status`; it prints the log path and, on Linux, whether the
service is running, enabled, and allowed to survive logout.

| Status                                  | Next step                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `linger-disabled`                       | `sudo loginctl enable-linger "$(id -un)"`, then retry setup as the normal user |
| `linger-unavailable`                    | `loginctl show-user "$(id -un)" --property=Linger`; check systemd-logind      |
| `user-manager-unavailable`              | `systemctl --user status` in a login session for that user                    |
| `service-disabled` / `service-stopped`  | Read the log and `systemctl --user status t3code.service`, then run the repair command T3 Code prints |

Over SSH, `sudo` needs a TTY: `ssh -t host 'sudo loginctl enable-linger "$(id -un)"'`.
Run only the `loginctl` command with `sudo` — **running T3 Code itself as root
creates a separate installation and Connect identity.** Without administrator
access, fall back to `t3 serve` in a terminal that stays open.

On macOS, check **System Settings → General → Login Items** if it stops starting.
If agent work cannot reach Desktop, Documents, or Downloads, the Node executable
named in `ProgramArguments` of
`~/Library/LaunchAgents/com.t3tools.t3code.service.plist` needs Full Disk Access.

## App and Server Versions

The app and the server can be different machines and different versions. When a
server is behind, a notice appears in the conversation and in **Settings →
Connections**, naming the machine to update. Update **that** machine, not the
device being used.

| Offered action           | What it means                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------- |
| **Update server**        | Keep the client open while it installs and reconnects; a desktop-hosted server relaunches the app |
| **Update desktop app**   | Update the desktop app on the server's machine                                     |
| **Copy update command**  | Stop the command-line server and relaunch with the copied command                  |

For a background service, run the matching version on the host:

```sh
npx t3@<client-version> service update
```

`@latest` only resolves the mismatch when the client is on that release. For a
foreground server, relaunch `npx t3@<client-version>` — add `serve` if that is the
usual mode, and keep options such as `--host` or `--tailscale-serve`.

**Settings → General → Continue threads after restarts** (off by default) resumes
supported active threads after an update, crash, or reboot. It does not start
T3 Code for you, and threads without saved provider resume state still need a new
message.

If an update fails, keep the client open until it reconnects or reports failure — a
service update can roll back. Then retry once, confirm the right machine was
updated, and finally relaunch the exact version from the notice.

Further reading: [background service](https://github.com/pingdotgg/t3code/blob/main/docs/user/background-service.md),
[updating](https://github.com/pingdotgg/t3code/blob/main/docs/user/updating.md).
