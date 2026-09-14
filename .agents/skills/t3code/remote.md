# Remote Access

Read this before connecting a phone, browser, or second machine to a T3 Code
host, or before revoking access.

The host must stay running and reachable while the user works — see
[`service.md`](service.md).

**Pairing URLs and authorization codes are passwords.** Hand a full link to the
user, never paste one into a log, screenshot, bug report, or commit. A link
without its token is useless; a link with its token is full access.

## Choose the Route

| Situation                                        | Use                                    |
| ------------------------------------------------ | -------------------------------------- |
| Devices on different networks, no port forwarding | T3 Connect                             |
| Devices on the same LAN or tailnet                | Direct pairing                         |
| Tailnet and HTTPS wanted (needed by app.t3.codes) | Tailscale HTTPS                        |
| Agents should run on a server you SSH to          | Desktop-managed SSH environment        |

## T3 Connect

Desktop host: **Settings → Connections**, sign in, enable **T3 Connect**.

Command-line host:

```bash
npx t3@latest connect          # Set up this machine
npx t3 connect status          # Saved authorization and link config, not a liveness check
npx t3 connect unlink          # Stop exposing the machine, keep the login
npx t3 connect logout          # Also clear the stored login
```

Setup offers a background service. Declining it means the machine is only
reachable while `npx t3 serve` is running — saving the sign-in alone does not make
it reachable. Over SSH the CLI prints a browser link and takes the returned code,
so no callback port needs forwarding.

Deregister an environment from the account menu's **T3 Connect** page (or
**Settings → T3 Connect** on mobile). That frees its slot even if the machine is
gone.

## Direct Pairing

Desktop host: **Settings → Connections**, enable **Network access**, then create a
pairing link on an address the other device can reach. Enabling it restarts the
desktop app.

Command-line host:

```bash
npx t3 serve --host <private-ip>   # Start bound to a reachable address
npx t3 pair                        # Fresh link from an already-running server
```

Scan the QR code, or paste the URL into **Add environment** on the other device.
A loopback address such as `127.0.0.1` only reaches the device opening it. Each
new device gets its own one-time link; reconnecting later does not need the
original token. Links made in Settings can only be copied while that Connections
page stays open.

### Tailscale HTTPS

Both devices on the same tailnet, then:

```bash
npx t3 serve --tailscale-serve     # New server
npx t3 pair --tailscale            # Already-running server
```

The mapping persists across restarts. Remove it with
`tailscale serve --https=443 off`, or pick another port with
`--tailscale-serve-port` when 443 is taken.

[app.t3.codes](https://app.t3.codes) needs an HTTPS endpoint and connects directly
to the server, so a hosted link cannot make an unreachable or plain-HTTP backend
work. For plain HTTP on a LAN, open the direct pairing URL in a browser that
allows it, or pair from the desktop app. On mobile, an address typed without a
scheme is treated as HTTP.

## Desktop-managed SSH

**Settings → Connections → Add environment → SSH**, with a host or SSH alias.
T3 Code starts or reuses a server there and opens the port forward. Projects,
credentials, and agent work stay on the remote machine.

The remote host needs a compatible Node.js and its own provider setup. When launch
cannot find Node, check a non-interactive shell — that is what SSH gets:

```bash
ssh user@example.com 'sh -lc "command -v node && node --version"'
```

A version manager that only initializes for interactive shells is the usual cause;
`nvm alias default 24` fixes it. Removing the connection stops a server T3 Code
launched and leaves a pre-existing one alone.

## Revoke Access

**Settings → Connections** on the host lets an administrator create links and
revoke sessions: revoke an unused link to prevent new pairings, revoke a device's
session to cut its existing access. A session with an open connection stays
listed until it drops.

```bash
npx t3 auth pairing list      # Outstanding one-time pairing tokens
npx t3 auth pairing revoke <id>
npx t3 auth session list      # Active bearer sessions
npx t3 auth session revoke <id>
```

`t3 auth pairing create` and `t3 auth session issue` mint new credentials. Only
issue one when the user asked for it, and hand it over directly.

## Troubleshooting

`t3 connect status` shows saved authorization, not reachability. If the
environment looks offline, check `t3 service status` and read the log it names.

| Symptom                                          | Recovery                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `environment_link_limit_exceeded`                | Deregister an unused environment, restart T3 Code on the host                        |
| `auth_invalid` / `invalid_bearer`                | `t3 connect login`; if revoked, `t3 connect logout` then `t3 connect`, and restart   |
| Expired or invalid link proof                    | Check the host clock, update T3 Code, restart                                        |
| HTTP 403 with no recognized error                | Relay access, proxies, firewall; keep any Cloudflare Ray ID for a report             |
| HTTP 408, 429, 5xx                               | Network or relay availability; startup retries for up to ten minutes                 |
| Disappears when the SSH session closes           | The service is not lingering — see [`service.md`](service.md)                        |

After fixing a permanent rejection, restart the host's server:
`systemctl --user restart t3code.service` for a Linux service, or stop and rerun
`t3 serve` with the usual options.

Further reading: [remote access](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md).
